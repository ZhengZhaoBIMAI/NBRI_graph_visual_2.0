const svg = document.querySelector("#graph");
const infoName = document.querySelector("#info-name");
const infoFields = document.querySelector("#info-fields");
const svgNamespace = "http://www.w3.org/2000/svg";
const assetBase = window.nbriGraphBase || "./";
const expandedLabDistance = 280;
const collaborationBranchDefaultDistance = 260;
const collaborationBranchDefaultSpread = 168;
const institutionBranchExtraDistance = 72;
const edgeLabelDistance = 12;
const edgeLabelTextClearance = 8;

const nodes = window.nbriGraphData.nodes.map((node) => ({
  ...node,
  radius: detailOuterNodeType(node.kind) ? Math.max(node.radius, 13) : node.radius,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  visible: true,
}));
const links = window.nbriGraphData.links.map((link) => ({ ...link }));

const nodeById = new Map(nodes.map((node) => [node.id, node]));
const researcherIds = new Set(
  nodes.filter((node) => node.kind === "researcher").map((node) => node.id),
);
links.forEach((link) => {
  link.sourceNode = nodeById.get(link.source);
  link.targetNode = nodeById.get(link.target);
  link.label = edgeTypeLabel(link);
});

let width = 0;
let height = 0;
let hoveredResearcher = null;
const lockedHoverLabPositions = new Map();
let hoveredNode = null;
let pinnedInfoNode = null;
const requestedFocus = new URLSearchParams(window.location.search).get("focus");
let pinnedResearcher = researcherIds.has(requestedFocus) ? requestedFocus : null;
let draggingNode = null;
let dragPointer = null;
let dragOffset = null;
let rootPositionReady = false;
let userRootOverride = false;
const manualDetailPositions = new Map();
let lastFrame = performance.now();

const layers = {
  links: makeSvg("g", { class: "links" }),
  labels: makeSvg("g", { class: "labels" }),
  nodes: makeSvg("g", { class: "nodes" }),
};

svg.append(layers.links, layers.labels, layers.nodes);

links.forEach((link) => {
  link.element = makeSvg("line", { class: `graph-link ${link.relation}` });
  link.labelElement = makeSvg("text", { class: `edge-label ${link.relation}` });
  link.labelElement.textContent = link.label;
  layers.links.append(link.element);
  layers.labels.append(link.labelElement);
});

nodes.forEach((node) => {
  node.element = makeSvg("g", {
    class: `node ${node.kind}${node.detail ? " detail-node" : ""}`,
    tabindex: node.kind === "researcher" ? "0" : "-1",
    "aria-label": node.label.replaceAll("\n", " "),
  });
  node.shape = createNodeShape(node);
  node.text = makeSvg("text");
  writeNodeText(node);
  node.element.append(node.shape, node.text);
  layers.nodes.append(node.element);
  bindInfoEvents(node);

  if (node.kind === "researcher") {
    bindResearcherEvents(node.element, node.id);
  }

});

svg.addEventListener("pointermove", (event) => {
  if (draggingNode) {
    dragPointer = svgPoint(event);
  }
});

svg.addEventListener("pointerup", releaseDrag);
svg.addEventListener("pointercancel", releaseDrag);
svg.addEventListener("click", (event) => {
  if (event.target === svg) {
    setPinnedResearcher(null);
    pinnedInfoNode = null;
    updateInfoCard();
  }
});

nodes.forEach((node) => {
  node.element.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    draggingNode = node;
    dragPointer = svgPoint(event);
    dragOffset = {
      x: node.x - dragPointer.x,
      y: node.y - dragPointer.y,
    };

    if (node.kind === "root") {
      userRootOverride = true;
      manualDetailPositions.clear();
      lockedHoverLabPositions.clear();
    }

    node.element.classList.add("dragging");
    node.element.setPointerCapture(event.pointerId);
  });
});

const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(svg);
resize();
requestAnimationFrame(startGraph);

function makeSvg(tag, attributes = {}) {
  const element = document.createElementNS(svgNamespace, tag);
  Object.entries(attributes).forEach(([name, value]) => {
    element.setAttribute(name, value);
  });
  return element;
}

function edgeTypeLabel(link) {
  if (link.preview) {
    return "";
  }

  if (link.sourceNode?.kind === "researcher" && link.targetNode?.kind === "lab") {
    return "Heads";
  }

  if (
    link.targetNode?.kind === "workplace" &&
    link.sourceNode?.kind === "collaborator"
  ) {
    return "Works in";
  }

  if (link.relation === "affiliate") {
    return "Affiliated with";
  }

  if (link.relation === "cooperate") {
    return "Cooperated with";
  }

  return "";
}

function createNodeShape(node) {
  if (!isIconNode(node)) {
    node.shapeSize = node.radius * 2;
    return makeSvg("circle", { r: node.radius });
  }

  const iconSize =
    isLabLikeNode(node)
      ? 36
      : node.kind === "university"
        ? 26
        : node.kind === "workplace"
          ? 36
          : 34;
  node.shapeSize = iconSize;
  const iconClass =
    isLabLikeNode(node)
      ? "lab-icon"
      : node.kind === "university"
      ? "university-icon"
      : node.kind === "workplace"
        ? "workplace-icon"
        : "person-icon";
  const iconPath =
    isLabLikeNode(node)
      ? assetPath("laboratory.png")
      : node.kind === "university"
      ? assetPath("university-node.png")
      : node.kind === "workplace"
        ? assetPath("workplace-node.png")
        : assetPath("person-node.png");
  return makeSvg("image", {
    class: iconClass,
    href: iconPath,
    x: -iconSize / 2,
    y: -iconSize / 2,
    width: iconSize,
    height: iconSize,
    preserveAspectRatio: "xMidYMid meet",
  });
}

function assetPath(filename) {
  return `${assetBase}${filename}`;
}

function isIconNode(node) {
  return (
    isPersonNode(node) ||
    isLabLikeNode(node) ||
    node.kind === "workplace" ||
    node.kind === "university"
  );
}

function isLabLikeNode(node) {
  return node.kind === "lab" || node.kind === "preview";
}

function isPersonNode(node) {
  return ["member", "collaborator", "academic-collaborator"].includes(node.kind);
}

function detailOuterNodeType(kind) {
  return {
    lab: "Laboratory",
    preview: "Laboratory",
    member: "Lab member",
    collaborator: "Industrial Collaborator",
    workplace: "Company",
    "academic-collaborator": "Academic Collaborator",
    university: "University",
  }[kind];
}

function writeNodeText(node) {
  const nodeType = detailOuterNodeType(node.kind);
  const isExternalLabel = Boolean(nodeType) || node.kind === "partner";
  const lines = isExternalLabel ? [node.label.replaceAll("\n", " ")] : node.label.split("\n");
  const labelY = externalLabelY(node);
  const fontSize =
    node.kind === "root"
      ? 28
      : isExternalLabel
        ? 13
      : node.radius <= 35
        ? 11
        : node.radius <= 43
          ? 12
          : 14;

  node.text.setAttribute("font-size", fontSize);
  lines.forEach((line, index) => {
    const tspan = makeSvg(
      "tspan",
      isExternalLabel
        ? {
            x: "0",
            y: index === 0 ? `${labelY}` : null,
            dy: index === 0 ? "0" : "1.08em",
          }
        : {
            x: "0",
            dy: index === 0 ? `${-(lines.length - 1) * 0.54}em` : "1.08em",
          },
    );

    if (isExternalLabel && index > 0) {
      tspan.removeAttribute("y");
    }

    tspan.textContent = line;
    node.text.append(tspan);
  });

  if (nodeType) {
    const type = makeSvg("tspan", {
      x: "0",
      dy: "1.36em",
      class: "node-type",
    });
    type.textContent = nodeType;
    node.text.append(type);
  }

  if (node.kind === "researcher" && node.role) {
    const role = makeSvg("tspan", {
      x: "0",
      dy: "1.42em",
      class: "node-role",
    });
    role.textContent = node.role;
    node.text.append(role);
  }
}

function externalLabelY(node) {
  const visualRadius = isIconNode(node) ? (node.shapeSize || node.radius * 2) / 2 : node.radius;
  return visualRadius + 18;
}

function bindInfoEvents(node) {
  node.element.addEventListener("pointerenter", () => {
    hoveredNode = node.id;
    updateInfoCard();
  });
  node.element.addEventListener("pointerleave", () => {
    hoveredNode = null;
    updateInfoCard();
  });
  node.element.addEventListener("click", () => {
    pinnedInfoNode = node.id;
    updateInfoCard();
  });
  node.element.addEventListener("focus", () => {
    hoveredNode = node.id;
    updateInfoCard();
  });
  node.element.addEventListener("blur", () => {
    hoveredNode = null;
    updateInfoCard();
  });
}

function bindResearcherEvents(element, researcherId) {
  element.addEventListener("pointerenter", () => {
    hoveredResearcher = researcherId;
    lockHoveredLabPosition(researcherId);
  });
  element.addEventListener("pointerleave", () => {
    hoveredResearcher = null;
    lockedHoverLabPositions.delete(researcherId);
  });
  element.addEventListener("click", (event) => {
    event.stopPropagation();
    setPinnedResearcher(pinnedResearcher === researcherId ? null : researcherId);
  });
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    setPinnedResearcher(pinnedResearcher === researcherId ? null : researcherId);
  });
}

function setPinnedResearcher(researcherId) {
  pinnedResearcher = researcherId;
  userRootOverride = false;
  manualDetailPositions.clear();
  lockedHoverLabPositions.clear();
}

function lockHoveredLabPosition(researcherId) {
  nodes
    .filter((node) => node.kind === "lab" && node.owner === researcherId)
    .forEach((node) => {
      const anchor = hoverPreviewAllowsOverflow(researcherId)
        ? anchorFor(node, researcherId)
        : clampDetailAnchor(anchorFor(node, researcherId), node);
      lockedHoverLabPositions.set(node.id, anchor);
    });
}

function releaseDrag() {
  if (draggingNode?.detail && draggingNode.owner === activeResearcher()) {
    const position = fitNodeInsideGraph(draggingNode, {
      x: draggingNode.x,
      y: draggingNode.y,
    });
    manualDetailPositions.set(draggingNode.id, position);
    draggingNode.x = position.x;
    draggingNode.y = position.y;
  }

  draggingNode?.element.classList.remove("dragging");
  draggingNode = null;
  dragPointer = null;
  dragOffset = null;
}

function resize() {
  const bounds = svg.getBoundingClientRect();
  width = bounds.width;
  height = bounds.height;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const center = nodeById.get("nbri");
  const nextCenter = rootPositionReady
    ? fitNodeInsideGraph(center, { x: center.x, y: center.y })
    : { x: width * 0.48, y: height * 0.51 };
  center.x = nextCenter.x;
  center.y = nextCenter.y;
  center.vx = 0;
  center.vy = 0;
  rootPositionReady = true;
}

function seedPositions() {
  nodes.forEach((node, index) => {
    if (node.id === "nbri") {
      return;
    }

    const angle = node.angle ?? index * 0.62;
    const center = anchorFor(node);
    const distance = node.parent ? 118 : node.owner ? 126 : 245;
    node.x = center.x + Math.cos(angle) * distance;
    node.y = center.y + Math.sin(angle) * distance;
  });
}

function startGraph() {
  resize();
  seedPositions();
  updateInfoCard();
  requestAnimationFrame(tick);
}

function activeResearcher() {
  return pinnedResearcher || hoveredResearcher;
}

function hoverPreviewAllowsOverflow(activeId) {
  return Boolean(activeId && activeId === hoveredResearcher && activeId !== pinnedResearcher);
}

function updateRootPosition(delta) {
  const root = nodeById.get("nbri");

  if (root === draggingNode && dragPointer) {
    const dragPosition = fitNodeInsideGraph(root, dragTarget());
    root.x = dragPosition.x;
    root.y = dragPosition.y;
    root.vx = 0;
    root.vy = 0;
    return;
  }

  if (userRootOverride) {
    return;
  }

  const target = pinnedResearcher
    ? rootTargetForResearcher(pinnedResearcher)
    : defaultRootTarget();
  const followStrength = Math.min((pinnedResearcher ? 0.12 : 0.07) * delta, 1);

  root.x += (target.x - root.x) * followStrength;
  root.y += (target.y - root.y) * followStrength;
  root.vx = 0;
  root.vy = 0;
}

function defaultRootTarget() {
  return fitNodeInsideGraph(nodeById.get("nbri"), {
    x: width * 0.48,
    y: height * 0.51,
  });
}

function rootTargetForResearcher(researcherId) {
  const root = nodeById.get("nbri");
  const researcher = nodeById.get(researcherId);

  if (!researcher) {
    return defaultRootTarget();
  }

  const angle =
    typeof researcher.angle === "number"
      ? researcher.angle
      : Math.atan2(researcher.y - root.y, researcher.x - root.x);
  const direction = {
    x: Math.cos(angle),
    y: Math.sin(angle),
  };
  const overviewDistance = researcher.branchDistance || 224;
  const researcherCenter = {
    x: width * 0.48,
    y: height * 0.48,
  };

  return fitNodeInsideGraph(root, {
    x: researcherCenter.x - direction.x * overviewDistance,
    y: researcherCenter.y - direction.y * overviewDistance,
  });
}

function updateInfoCard() {
  const node = nodeById.get(hoveredNode || pinnedInfoNode || "nbri");
  const info = node.info || {};
  const fields = [
    ["Hebrew Name", info.hebrewName],
    ["Affiliation", info.affiliation],
    ["Website", info.website],
  ].filter(([, value]) => value);

  infoName.textContent = info.name || node.label.replaceAll("\n", " ");
  infoFields.replaceChildren();

  fields.forEach(([label, value]) => {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;

    if (label === "Website") {
      const link = document.createElement("a");
      link.href = value;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = value;
      description.append(link);
    } else {
      description.textContent = value;
    }

    row.append(term, description);
    infoFields.append(row);
  });
}

function tick(now) {
  const delta = Math.min((now - lastFrame) / 16.67, 2);
  lastFrame = now;
  simulate(delta);
  render();
  requestAnimationFrame(tick);
}

function simulate(delta) {
  const activeId = activeResearcher();
  updateRootPosition(delta);
  const visibleNodes = nodes.filter((node) => nodeOpacity(node, activeId) > 0.03);

  visibleNodes.forEach((node) => {
    if (node.id === "nbri") {
      return;
    }

    const anchor = anchorFor(node, activeId);
    const anchorForce = (node.owner
      ? node.detail && node.owner === activeId
        ? 0.026
        : 0.018
      : node.parent
        ? 0.024
        : 0.042) * (draggingNode?.kind === "root" ? 1.55 : 1);
    node.vx += (anchor.x - node.x) * anchorForce * delta;
    node.vy += (anchor.y - node.y) * anchorForce * delta;
  });

  for (let first = 0; first < visibleNodes.length; first += 1) {
    for (let second = first + 1; second < visibleNodes.length; second += 1) {
      if (visibleNodes[first].owner || visibleNodes[second].owner) {
        continue;
      }

      repel(visibleNodes[first], visibleNodes[second], delta);
    }
  }

  links.forEach((link) => {
    if (link.preview || link.detail || linkOpacity(link, activeId) <= 0.03) {
      return;
    }

    spring(link, delta);
  });

  avoidBaseLinkContacts(visibleNodes, activeId, delta);

  nodes.forEach((node) => {
    if (node.id === "nbri") {
      if (node === draggingNode && dragPointer) {
        const dragPosition = fitNodeInsideGraph(node, dragTarget());
        node.x = dragPosition.x;
        node.y = dragPosition.y;
      }

      node.vx = 0;
      node.vy = 0;
      return;
    }

    if (node === draggingNode && dragPointer) {
      const dragPosition =
        node.detail && node.owner === activeId
          ? safeDetailDragPosition(node, dragTarget(), activeId, visibleNodes)
          : fitNodeInsideGraph(node, dragTarget());
      node.x = dragPosition.x;
      node.y = dragPosition.y;
      node.vx = 0;
      node.vy = 0;
      return;
    }

    if (node.owner) {
      const manualPosition = manualDetailPositions.get(node.id);
      if (node.detail && manualPosition) {
        node.x = manualPosition.x;
        node.y = manualPosition.y;
        node.vx = 0;
        node.vy = 0;
        return;
      }

      const lockedLabPosition =
        node.kind === "lab" && node.owner === hoveredResearcher
          ? lockedHoverLabPositions.get(node.id)
          : null;
      if (lockedLabPosition) {
        node.x = lockedLabPosition.x;
        node.y = lockedLabPosition.y;
        node.vx = 0;
        node.vy = 0;
        return;
      }

      const localAnchor =
        node.kind === "preview" ? previewAnchorFor(node, activeId) : anchorFor(node, activeId);
      const safeAnchor = hoverPreviewAllowsOverflow(activeId)
        ? localAnchor
        : clampDetailAnchor(localAnchor, node);
      const followStrength = node.detail ? Math.min(0.34 * delta, 1) : 1;
      node.x += (safeAnchor.x - node.x) * followStrength;
      node.y += (safeAnchor.y - node.y) * followStrength;
      node.vx = 0;
      node.vy = 0;
      return;
    }

    node.vx *= 0.83;
    node.vy *= 0.83;
    node.x += node.vx * delta;
    node.y += node.vy * delta;
    const horizontalPadding =
      ["partner", "member", "collaborator", "academic-collaborator", "workplace", "university"].includes(node.kind)
        ? 52
        : node.radius + 18;
    node.x = clamp(node.x, horizontalPadding, width - horizontalPadding);
    node.y = clamp(node.y, node.radius + 18, height - node.radius - 18);
  });

  resolveDetailLayout(activeId, visibleNodes);
}

function anchorFor(node, activeId = activeResearcher()) {
  const center = nodeById.get("nbri");

  if (node.parent) {
    const parent = nodeById.get(node.parent);
    const direction = ownerDirection(parent);
    return {
      x: parent.x + direction.x * (node.branchDistance || 214) + direction.normalX * (node.spread || 0),
      y: parent.y + direction.y * (node.branchDistance || 214) + direction.normalY * (node.spread || 0),
    };
  }

  if (node.owner) {
    const owner = nodeById.get(node.owner);
    const active = node.owner === activeId;
    const direction = ownerDirection(owner);

    if (node.kind === "member") {
      const labAnchor = anchorFor(detailParentFor(node, "lab"), activeId);
      return {
        x: labAnchor.x + direction.x * (node.branchDistance || 214) + direction.normalX * (node.spread || 0),
        y: labAnchor.y + direction.y * (node.branchDistance || 214) + direction.normalY * (node.spread || 0),
      };
    }

    if (node.kind === "collaborator" || node.kind === "academic-collaborator") {
      const distance = collaborationBranchDistance(node);
      return {
        x: owner.x + direction.x * distance + direction.normalX * collaborationBranchSpread(node),
        y: owner.y + direction.y * distance + direction.normalY * collaborationBranchSpread(node),
      };
    }

    if (node.kind === "workplace" || node.kind === "university") {
      const parentKind = node.kind === "university" ? "academic-collaborator" : "collaborator";
      const collaboratorAnchor = anchorFor(detailParentFor(node, parentKind), activeId);
      const collaboratorDirection = institutionDirection(
        node,
        owner,
        collaboratorAnchor,
        direction,
      );
      return {
        x: collaboratorAnchor.x + collaboratorDirection.x * institutionBranchDistance(node),
        y: collaboratorAnchor.y + collaboratorDirection.y * institutionBranchDistance(node),
      };
    }

    const distance = node.kind === "preview" ? 128 : active ? expandedLabDistance : 120;
    return {
      x: owner.x + direction.x * distance,
      y: owner.y + direction.y * distance,
    };
  }

  const mainDistance =
    node.branchDistance || (node.kind === "hub" ? Math.min(width, height) * 0.32 : 224);
  return {
    x: center.x + Math.cos(node.angle) * mainDistance,
    y: center.y + Math.sin(node.angle) * mainDistance,
  };
}

function ownerDirection(owner) {
  const center = nodeById.get("nbri");
  const dx = owner.x - center.x;
  const dy = owner.y - center.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: dx / length,
    y: dy / length,
    normalX: -dy / length,
    normalY: dx / length,
  };
}

function detailParentFor(node, kind) {
  const parentLink = links.find(
    (link) => link.target === node.id && link.sourceNode?.kind === kind,
  );
  return parentLink?.sourceNode || nodeById.get(node.owner);
}

function pointDirection(from, to, fallback) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);

  if (!length) {
    return fallback;
  }

  return {
    x: dx / length,
    y: dy / length,
  };
}

function collaborationBranchDistance(node) {
  return node.branchDistance || collaborationBranchDefaultDistance;
}

function collaborationBranchSpread(node) {
  return node.spread || collaborationBranchDefaultSpread;
}

function institutionDirection(node, owner, collaborator, fallback) {
  const baseDirection = pointDirection(owner, collaborator, fallback);
  const turn = ((node.kind === "university" ? -30 : 30) * Math.PI) / 180;
  return rotateDirection(baseDirection, turn);
}

function institutionBranchDistance(node) {
  return (node.branchDistance || 128) + institutionBranchExtraDistance;
}

function rotateDirection(direction, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: direction.x * cos - direction.y * sin,
    y: direction.x * sin + direction.y * cos,
  };
}

function clampDetailAnchor(anchor, node) {
  const topPadding =
    node.kind === "workplace" || node.kind === "university"
      ? 178
      : node.detail
        ? 126
        : node.radius + 18;
  return {
    x: clamp(anchor.x, node.radius + 24, width - node.radius - 24),
    y: clamp(anchor.y, topPadding, height - node.radius - 24),
  };
}

function resolveDetailLayout(activeId, visibleNodes) {
  if (!activeId) {
    return;
  }

  const activeDetails = visibleNodes
    .filter((node) => node.detail && node.owner === activeId)
    .sort((first, second) => detailLayoutRank(first) - detailLayoutRank(second));
  const activeDetailIds = new Set(activeDetails.map((node) => node.id));
  const occupied = visibleNodes
    .filter((node) => !node.detail || node.owner !== activeId)
    .map((node) => layoutOccupancy(node, { x: node.x, y: node.y }));
  const occupiedLinks = layoutLinkSegments(activeId, activeDetailIds);
  activeDetails
    .filter((node) => manualDetailPositions.has(node.id))
    .forEach((node) => {
      const position = manualDetailPositions.get(node.id);
      occupied.push(layoutOccupancy(node, position));
      const incoming = incomingLayoutSegment(node, position, activeId);
      if (incoming) {
        occupiedLinks.push(incoming);
      }
    });

  activeDetails.forEach((node) => {
    const manualPosition = manualDetailPositions.get(node.id);
    if (manualPosition) {
      return;
    }

    if (node === draggingNode) {
      occupied.push(layoutOccupancy(node, { x: node.x, y: node.y }));
      return;
    }

    const allowOverflow = hoverPreviewAllowsOverflow(activeId);
    const anchor = allowOverflow
      ? detailLayoutAnchor(node, activeId)
      : clampDetailAnchor(detailLayoutAnchor(node, activeId), node);
    const direction = detailOutwardDirection(node, anchor);
    const position = freeDetailPosition(
      node,
      anchor,
      direction,
      occupied,
      occupiedLinks,
      allowOverflow,
    );

    node.x = position.x;
    node.y = position.y;
    node.vx = 0;
    node.vy = 0;
    occupied.push(layoutOccupancy(node, position));
    const incoming = incomingLayoutSegment(node, position, activeId);
    if (incoming) {
      occupiedLinks.push(incoming);
    }
  });
}

function detailLayoutAnchor(node, activeId) {
  const owner = nodeById.get(node.owner);
  const direction = ownerDirection(owner);

  if (node.kind === "member") {
    const lab = detailParentFor(node, "lab");
    return {
      x: lab.x + direction.x * (node.branchDistance || 214) + direction.normalX * (node.spread || 0),
      y: lab.y + direction.y * (node.branchDistance || 214) + direction.normalY * (node.spread || 0),
    };
  }

  if (node.kind === "workplace" || node.kind === "university") {
    const parentKind = node.kind === "university" ? "academic-collaborator" : "collaborator";
    const collaborator = detailParentFor(node, parentKind);
    const collaboratorDirection = institutionDirection(node, owner, collaborator, direction);
    return {
      x: collaborator.x + collaboratorDirection.x * institutionBranchDistance(node),
      y: collaborator.y + collaboratorDirection.y * institutionBranchDistance(node),
    };
  }

  return anchorFor(node, activeId);
}

function detailLayoutRank(node) {
  if (node.kind === "lab") {
    return 0;
  }

  if (node.kind === "member") {
    return 1;
  }

  if (node.kind === "collaborator" || node.kind === "academic-collaborator") {
    return 2;
  }

  if (node.kind === "workplace" || node.kind === "university") {
    return 3;
  }

  return 4;
}

function detailOutwardDirection(node, anchor) {
  const owner = nodeById.get(node.owner);
  const fallback = ownerDirection(owner);

  if (node.kind === "member") {
    return pointDirection(detailParentFor(node, "lab"), anchor, fallback);
  }

  if (node.kind === "workplace" || node.kind === "university") {
    const parentKind = node.kind === "university" ? "academic-collaborator" : "collaborator";
    return pointDirection(detailParentFor(node, parentKind), anchor, fallback);
  }

  return pointDirection(owner, anchor, fallback);
}

function freeDetailPosition(
  node,
  anchor,
  direction,
  occupied,
  occupiedLinks,
  allowOverflow = false,
) {
  const normal = { x: -direction.y, y: direction.x };
  const lateralSteps = [0, -46, 46, -92, 92, -138, 138, -184, 184];

  for (let extension = 0; extension <= 1248; extension += 52) {
    for (const lateral of lateralSteps) {
      const rawCandidate = {
        x: anchor.x + direction.x * extension + normal.x * lateral,
        y: anchor.y + direction.y * extension + normal.y * lateral,
      };
      const candidate = allowOverflow ? rawCandidate : fitNodeInsideGraph(node, rawCandidate);
      const box = worldLayoutBox(node, candidate);

      if (detailPositionIsClear(node, candidate, box, occupied, occupiedLinks)) {
        return candidate;
      }
    }
  }

  return allowOverflow
    ? anchor
    : searchOpenCanvasPosition(node, anchor, occupied, occupiedLinks);
}

function safeDetailDragPosition(node, desired, activeId, visibleNodes) {
  const candidate = fitNodeInsideGraph(node, desired);
  const occupied = visibleNodes
    .filter((other) => other.id !== node.id)
    .map((other) => layoutOccupancy(other, { x: other.x, y: other.y }));
  const occupiedLinks = layoutLinkSegments(activeId);
  const box = worldLayoutBox(node, candidate);
  const collides =
    occupied.some((other) => boxesOverlap(box, other, 14)) ||
    boxTouchesLinks(node, box, occupiedLinks) ||
    incomingLinkCollides(node, candidate, occupied, occupiedLinks);

  return collides ? { x: node.x, y: node.y } : candidate;
}

function detailPositionIsClear(node, position, box, occupied, occupiedLinks) {
  return (
    !occupied.some((other) => boxesOverlap(box, other, 14)) &&
    !incomingEdgeLabelCollides(node, position, occupied) &&
    !nodeTextTouchesExistingEdgeLabels(node, position, occupiedLinks) &&
    !boxTouchesLinks(node, box, occupiedLinks) &&
    !incomingLinkCollides(node, position, occupied, occupiedLinks)
  );
}

function incomingEdgeLabelCollides(node, position, occupied) {
  const link = links.find(
    (candidate) => candidate.target === node.id && linkOpacity(candidate, activeResearcher()) > 0.03,
  );

  if (!link?.label) {
    return false;
  }

  const original = { x: link.targetNode.x, y: link.targetNode.y };
  link.targetNode.x = position.x;
  link.targetNode.y = position.y;
  const labelPoint = edgeLabelPoint(link);
  const labelBox = edgeLabelBox(link, labelPoint);
  const targetTextBox = worldTextBox(node, position);
  link.targetNode.x = original.x;
  link.targetNode.y = original.y;

  if (boxesOverlap(labelBox, targetTextBox, edgeLabelTextClearance)) {
    return true;
  }

  return occupied.some((other) =>
    boxesOverlap(labelBox, other.textBox || other, edgeLabelTextClearance),
  );
}

function nodeTextTouchesExistingEdgeLabels(node, position, occupiedLinks) {
  const textBox = worldTextBox(node, position);

  return occupiedLinks.some((segment) => {
    if (!segment.link?.label || segmentsShareNode(segment, { source: node.id, target: node.id })) {
      return false;
    }

    const labelPoint = edgeLabelPoint(segment.link);
    const labelBox = edgeLabelBox(segment.link, labelPoint);
    return boxesOverlap(textBox, labelBox, edgeLabelTextClearance);
  });
}

function searchOpenCanvasPosition(node, anchor, occupied, occupiedLinks) {
  const candidates = [];
  const step = 44;

  for (let y = 54; y <= height - 54; y += step) {
    for (let x = 54; x <= width - 54; x += step) {
      const position = fitNodeInsideGraph(node, { x, y });
      candidates.push({
        position,
        distance: Math.hypot(position.x - anchor.x, position.y - anchor.y),
      });
    }
  }

  candidates.sort((first, second) => first.distance - second.distance);
  const openCandidate = candidates.find(({ position }) => {
    const box = worldLayoutBox(node, position);
    return detailPositionIsClear(node, position, box, occupied, occupiedLinks);
  });

  return openCandidate?.position || fitNodeInsideGraph(node, anchor);
}

function layoutLinkSegments(activeId, ignoredTargets = new Set()) {
  return links
    .filter((link) => linkOpacity(link, activeId) > 0.03 && !ignoredTargets.has(link.target))
    .map((link) => ({
      link,
      source: link.source,
      target: link.target,
      x1: link.sourceNode.x,
      y1: link.sourceNode.y,
      x2: link.targetNode.x,
      y2: link.targetNode.y,
    }));
}

function incomingLayoutSegment(node, position, activeId) {
  const link = links.find(
    (candidate) =>
      candidate.target === node.id && linkOpacity(candidate, activeId) > 0.03,
  );

  if (!link) {
    return null;
  }

  return {
    link,
    source: link.source,
    target: node.id,
    x1: link.sourceNode.x,
    y1: link.sourceNode.y,
    x2: position.x,
    y2: position.y,
  };
}

function boxTouchesLinks(node, box, occupiedLinks) {
  return occupiedLinks.some((segment) => {
    if (segment.source === node.id || segment.target === node.id) {
      return false;
    }

    return segmentTouchesBox(segment, padBox(box, 8));
  });
}

function incomingLinkCollides(node, position, occupied, occupiedLinks) {
  const segment = incomingLayoutSegment(node, position, activeResearcher());

  if (!segment) {
    return false;
  }

  const touchesOccupiedNode = occupied.some((box) => {
    if (box.id === segment.source || box.id === segment.target) {
      return false;
    }

    return segmentTouchesBox(segment, padBox(box, 8));
  });
  const crossesLink = occupiedLinks.some((other) => {
    if (segmentsShareNode(segment, other)) {
      return false;
    }

    return segmentsIntersect(segment, other);
  });

  return touchesOccupiedNode || crossesLink;
}

function fitNodeInsideGraph(node, position) {
  const box = localLayoutBox(node);
  return {
    x: clamp(position.x, 22 - box.x, width - 22 - box.x - box.width),
    y: clamp(position.y, 22 - box.y, height - 22 - box.y - box.height),
  };
}

function dragTarget() {
  return {
    x: dragPointer.x + (dragOffset?.x || 0),
    y: dragPointer.y + (dragOffset?.y || 0),
  };
}

function worldLayoutBox(node, position) {
  const box = localLayoutBox(node);
  return {
    id: node.id,
    x: position.x + box.x,
    y: position.y + box.y,
    width: box.width,
    height: box.height,
  };
}

function layoutOccupancy(node, position) {
  return {
    ...worldLayoutBox(node, position),
    textBox: worldTextBox(node, position),
  };
}

function worldTextBox(node, position) {
  const textBox = safeTextBox(node);

  if (!textBox) {
    return worldLayoutBox(node, position);
  }

  return {
    id: node.id,
    x: position.x + textBox.x,
    y: position.y + textBox.y,
    width: textBox.width,
    height: textBox.height,
  };
}

function localLayoutBox(node) {
  const shapeRadius = (node.shapeSize || node.radius * 2) / 2;
  const shapeBox = {
    x: -shapeRadius,
    y: -shapeRadius,
    width: shapeRadius * 2,
    height: shapeRadius * 2,
  };
  const textBox = safeTextBox(node);

  if (!textBox) {
    return padBox(shapeBox, 6);
  }

  return padBox(unionBox(shapeBox, textBox), 6);
}

function safeTextBox(node) {
  try {
    const box = node.text.getBBox();
    return box.width || box.height ? box : null;
  } catch {
    return null;
  }
}

function unionBox(first, second) {
  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  const right = Math.max(first.x + first.width, second.x + second.width);
  const bottom = Math.max(first.y + first.height, second.y + second.height);

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

function padBox(box, padding) {
  return {
    x: box.x - padding,
    y: box.y - padding,
    width: box.width + padding * 2,
    height: box.height + padding * 2,
  };
}

function boxesOverlap(first, second, padding = 0) {
  return (
    first.x - padding < second.x + second.width &&
    first.x + first.width + padding > second.x &&
    first.y - padding < second.y + second.height &&
    first.y + first.height + padding > second.y
  );
}

function segmentTouchesBox(segment, box) {
  const left = box.x;
  const right = box.x + box.width;
  const top = box.y;
  const bottom = box.y + box.height;

  if (
    pointInsideBox({ x: segment.x1, y: segment.y1 }, box) ||
    pointInsideBox({ x: segment.x2, y: segment.y2 }, box)
  ) {
    return true;
  }

  return [
    { x1: left, y1: top, x2: right, y2: top },
    { x1: right, y1: top, x2: right, y2: bottom },
    { x1: right, y1: bottom, x2: left, y2: bottom },
    { x1: left, y1: bottom, x2: left, y2: top },
  ].some((edge) => segmentsIntersect(segment, edge));
}

function pointInsideBox(point, box) {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

function segmentsShareNode(first, second) {
  return (
    first.source === second.source ||
    first.source === second.target ||
    first.target === second.source ||
    first.target === second.target
  );
}

function segmentsIntersect(first, second) {
  const firstA = { x: first.x1, y: first.y1 };
  const firstB = { x: first.x2, y: first.y2 };
  const secondA = { x: second.x1, y: second.y1 };
  const secondB = { x: second.x2, y: second.y2 };
  const cross1 = orientation(firstA, firstB, secondA);
  const cross2 = orientation(firstA, firstB, secondB);
  const cross3 = orientation(secondA, secondB, firstA);
  const cross4 = orientation(secondA, secondB, firstB);

  if (cross1 === 0 && pointOnSegment(firstA, secondA, firstB)) {
    return true;
  }
  if (cross2 === 0 && pointOnSegment(firstA, secondB, firstB)) {
    return true;
  }
  if (cross3 === 0 && pointOnSegment(secondA, firstA, secondB)) {
    return true;
  }
  if (cross4 === 0 && pointOnSegment(secondA, firstB, secondB)) {
    return true;
  }

  return cross1 !== cross2 && cross3 !== cross4;
}

function orientation(first, second, third) {
  const value =
    (second.y - first.y) * (third.x - second.x) -
    (second.x - first.x) * (third.y - second.y);

  if (Math.abs(value) < 0.001) {
    return 0;
  }

  return value > 0 ? 1 : -1;
}

function pointOnSegment(first, point, second) {
  return (
    point.x <= Math.max(first.x, second.x) &&
    point.x >= Math.min(first.x, second.x) &&
    point.y <= Math.max(first.y, second.y) &&
    point.y >= Math.min(first.y, second.y)
  );
}

function previewAnchorFor(node, activeId) {
  const owner = nodeById.get(node.owner);
  const direction = ownerDirection(owner);
  const candidates = [
    { distance: 136, spread: 0 },
    { distance: 164, spread: 0 },
    { distance: 196, spread: 0 },
    { distance: 228, spread: 0 },
    { distance: 168, spread: -64 },
    { distance: 168, spread: 64 },
    { distance: 202, spread: -96 },
    { distance: 202, spread: 96 },
    { distance: 238, spread: -132 },
    { distance: 238, spread: 132 },
    { distance: 272, spread: -172 },
    { distance: 272, spread: 172 },
  ];

  for (const candidate of candidates) {
    const point = {
      x: owner.x + direction.x * candidate.distance + direction.normalX * candidate.spread,
      y: owner.y + direction.y * candidate.distance + direction.normalY * candidate.spread,
    };

    if (!overlapsBaseNode(point, node, activeId)) {
      return point;
    }
  }

  return anchorFor(node, activeId);
}

function overlapsBaseNode(point, node, activeId) {
  const previewBox = worldLayoutBox(node, point);
  return nodes.some((other) => {
    if (other.id === node.id || other.owner) {
      return false;
    }

    if (nodeOpacity(other, activeId) <= 0.12) {
      return false;
    }

    return boxesOverlap(previewBox, worldLayoutBox(other, { x: other.x, y: other.y }), 18);
  });
}

function repel(first, second, delta) {
  const dx = second.x - first.x || 0.01;
  const dy = second.y - first.y || 0.01;
  const distanceSquared = dx * dx + dy * dy;
  const distance = Math.sqrt(distanceSquared);
  const desired = first.radius + second.radius + 22;

  if (distance > desired * 3.2) {
    return;
  }

  const collisionBoost = distance < desired ? 2.4 : 0.34;
  const force = (desired * desired * collisionBoost) / Math.max(distanceSquared, 1800);
  const fx = (dx / distance) * force * delta;
  const fy = (dy / distance) * force * delta;

  if (first.id !== "nbri") {
    first.vx -= fx / (first.mass || 1);
    first.vy -= fy / (first.mass || 1);
  }
  if (second.id !== "nbri") {
    second.vx += fx / (second.mass || 1);
    second.vy += fy / (second.mass || 1);
  }
}

function avoidBaseLinkContacts(visibleNodes, activeId, delta) {
  const baseNodes = visibleNodes.filter((node) => !node.owner && node.id !== "nbri");

  baseNodes.forEach((node) => {
    links.forEach((link) => {
      if (
        link.preview ||
        link.detail ||
        linkOpacity(link, activeId) <= 0.03 ||
        link.source === node.id ||
        link.target === node.id
      ) {
        return;
      }

      const nearest = nearestPointOnLink(node, link);
      const dx = node.x - nearest.x || 0.01;
      const dy = node.y - nearest.y || 0.01;
      const distance = Math.hypot(dx, dy);
      const clearance = node.radius + 22;

      if (distance >= clearance) {
        return;
      }

      const force = ((clearance - distance) / clearance) * 1.25 * delta;
      node.vx += (dx / distance) * force;
      node.vy += (dy / distance) * force;
    });
  });
}

function nearestPointOnLink(node, link) {
  const source = link.sourceNode;
  const target = link.targetNode;
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const lengthSquared = dx * dx + dy * dy || 1;
  const progress = clamp(
    ((node.x - source.x) * dx + (node.y - source.y) * dy) / lengthSquared,
    0,
    1,
  );

  return {
    x: source.x + dx * progress,
    y: source.y + dy * progress,
  };
}

function spring(link, delta) {
  const source = link.sourceNode;
  const target = link.targetNode;
  const dx = target.x - source.x || 0.01;
  const dy = target.y - source.y || 0.01;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const stretch = distance - link.distance;
  const force = stretch * link.strength * delta;
  const fx = (dx / distance) * force;
  const fy = (dy / distance) * force;

  if (source.id !== "nbri") {
    source.vx += fx / (source.mass || 1);
    source.vy += fy / (source.mass || 1);
  }
  if (target.id !== "nbri") {
    target.vx -= fx / (target.mass || 1);
    target.vy -= fy / (target.mass || 1);
  }
}

function render() {
  const activeId = activeResearcher();
  const edgeLabelOccupied = nodes
    .filter((node) => nodeOpacity(node, activeId) > 0.12)
    .map((node) => worldLayoutBox(node, { x: node.x, y: node.y }));

  links.forEach((link) => {
    const opacity = linkOpacity(link, activeId);
    link.element.setAttribute("x1", link.sourceNode.x);
    link.element.setAttribute("y1", link.sourceNode.y);
    link.element.setAttribute("x2", link.targetNode.x);
    link.element.setAttribute("y2", link.targetNode.y);
    link.element.setAttribute("stroke-opacity", opacity);
    link.element.setAttribute("stroke-width", linkWidth(link, activeId));
    const labelOpacity = edgeLabelOpacity(link, activeId, opacity);
    const labelPoint = edgeLabelPoint(link);
    link.labelElement.setAttribute("x", labelPoint.x);
    link.labelElement.setAttribute("y", labelPoint.y);
    link.labelElement.setAttribute("transform", `rotate(${labelPoint.angle} ${labelPoint.x} ${labelPoint.y})`);
    link.labelElement.setAttribute("opacity", labelOpacity);

    if (labelOpacity > 0) {
      edgeLabelOccupied.push(edgeLabelBox(link, labelPoint));
    }
  });

  nodes.forEach((node) => {
    const opacity = nodeOpacity(node, activeId);
    const onFocusPath = nodeInFocusSubtree(node, activeId);

    node.element.setAttribute("transform", `translate(${node.x} ${node.y})`);
    node.element.style.opacity = opacity;
    const detailIsInteractive =
      (!node.detail && node.kind !== "preview") || node.owner === pinnedResearcher;
    node.element.style.pointerEvents =
      opacity > 0.12 && detailIsInteractive ? "auto" : "none";
    node.element.classList.toggle("active", Boolean(activeId && onFocusPath));
    node.element.classList.toggle(
      "dimmed",
      Boolean(activeId && !onFocusPath),
    );
  });
}

function edgeLabelPoint(link) {
  const source = link.sourceNode;
  const target = link.targetNode;
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy) || 1;
  const labelProgress = link.source === "nbri" ? 0.58 : 0.52;
  const normalX = -dy / length;
  const normalY = dx / length;
  const offset = labelSide(link) * edgeLabelDistance;
  const angle = readableEdgeAngle(Math.atan2(dy, dx) * 180 / Math.PI);

  return {
    x: source.x + dx * labelProgress + normalX * offset,
    y: source.y + dy * labelProgress + normalY * offset,
    angle,
    progress: labelProgress,
    offsetScale: labelSide(link),
  };
}

function edgeLabelBox(link, point) {
  let bounds = { width: link.label.length * 5.4, height: 12 };

  try {
    const measured = link.labelElement.getBBox();
    if (measured.width && measured.height) {
      bounds = measured;
    }
  } catch {
    // Use the text-length estimate until the SVG label has measurable bounds.
  }

  return rotatedBoxBounds(point.x, point.y, bounds.width, bounds.height, point.angle);
}

function readableEdgeAngle(angle) {
  if (angle > 90 || angle < -90) {
    return angle + 180;
  }

  return angle;
}

function rotatedBoxBounds(centerX, centerY, width, height, angle) {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const corners = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ].map((corner) => ({
    x: centerX + corner.x * cos - corner.y * sin,
    y: centerY + corner.x * sin + corner.y * cos,
  }));
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);

  return {
    x: left,
    y: top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
  };
}

function labelSide(link) {
  if (link.label === "Works in" || link.targetNode?.kind === "university") {
    return -1;
  }

  return 1;
}

function edgeLabelOpacity(link, activeId, linkOpacityValue) {
  if (!link.label || link.preview || linkOpacityValue <= 0.08) {
    return 0;
  }

  if (link.detail) {
    return link.owner === activeId ? 1 : 0;
  }

  return linkOpacityValue > 0.22 ? 1 : 0;
}

function nodeOpacity(node, activeId) {
  if (node.detail) {
    return node.owner === activeId ? 1 : 0;
  }

  if (node.kind === "preview") {
    return activeId ? 0 : 0.44;
  }

  return activeId && !nodeInFocusSubtree(node, activeId) ? 0.16 : 1;
}

function linkOpacity(link, activeId) {
  if (link.detail) {
    return link.owner === activeId ? 0.94 : 0;
  }

  if (link.preview) {
    return activeId ? 0 : 0.18;
  }

  return activeId && !linkInFocusSubtree(link, activeId) ? 0.12 : 0.8;
}

function linkWidth(link, activeId) {
  const isSecondaryLink = link.detail || link.targetNode?.parent;

  if (isSecondaryLink) {
    return 1.8;
  }

  if (
    activeId &&
    ((link.source === "nbri" && link.target === activeId) ||
      (link.target === "nbri" && link.source === activeId))
  ) {
    return 2.6;
  }

  return link.preview ? 1.5 : link.relation === "cooperate" ? 3 : 3.2;
}

function nodeInFocusSubtree(node, activeId) {
  return !activeId || node.id === "nbri" || node.id === activeId || node.owner === activeId;
}

function linkInFocusSubtree(link, activeId) {
  if (!activeId) {
    return true;
  }

  return (
    link.owner === activeId ||
    (link.source === "nbri" && link.target === activeId) ||
    (link.target === "nbri" && link.source === activeId)
  );
}

function svgPoint(event) {
  const bounds = svg.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}
