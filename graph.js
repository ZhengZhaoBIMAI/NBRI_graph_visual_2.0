const svg = document.querySelector("#graph");
const graphViewport = document.querySelector("#graph-viewport");
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
let graphZoom = 1;
let viewportReady = false;
let cameraX = 0;
let cameraY = 0;
let viewportWidth = 1;
let viewportHeight = 1;
const activePointers = new Map();
let pinchGesture = null;
let dragStartScreen = null;
let backgroundPan = null;
let suppressBackgroundClick = false;
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
  // The institute and researchers use their original visible circle as the target.
  if (node.kind !== "root" && node.kind !== "researcher") {
    node.hitArea = makeSvg("rect", { class: "node-hit-area", rx: 10, "aria-hidden": "true" });
    node.element.append(node.hitArea);
  }
  node.element.append(node.shape, node.text);
  layers.nodes.append(node.element);
  bindInfoEvents(node);

  if (node.kind === "researcher") {
    bindResearcherEvents(node.element, node.id);
  }

});

svg.addEventListener("pointermove", event => {
  if (activePointers.has(event.pointerId)) activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pinchGesture && activePointers.size >= 2) {
    const [a, b] = [...activePointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const bounds = svg.getBoundingClientRect();
    zoomAt(pinchGesture.zoom * distance / pinchGesture.distance, {
      x: (a.x + b.x) / 2 - bounds.left,
      y: (a.y + b.y) / 2 - bounds.top,
    }, pinchGesture.anchor);
    return;
  }
  if (backgroundPan) {
    const dx = event.clientX - backgroundPan.x;
    const dy = event.clientY - backgroundPan.y;
    if (Math.hypot(dx, dy) > 4) suppressBackgroundClick = true;
    cameraX = backgroundPan.cameraX - dx / graphZoom;
    cameraY = backgroundPan.cameraY - dy / graphZoom;
    updateCamera();
    return;
  }
  if (draggingNode) {
    if (dragStartScreen && Math.hypot(event.clientX - dragStartScreen.x, event.clientY - dragStartScreen.y) > 4) suppressBackgroundClick = true;
    dragPointer = svgPoint(event);
  }
});

svg.addEventListener("pointerdown", event => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (!activePointers.size) suppressBackgroundClick = false;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (activePointers.size >= 2) {
    const [a, b] = [...activePointers.values()];
    pinchGesture = {
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      zoom: graphZoom,
      anchor: svgPoint({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }),
    };
    backgroundPan = null;
    draggingNode?.element.classList.remove("dragging");
    draggingNode = null;
    suppressBackgroundClick = true;
    svg.setPointerCapture(event.pointerId);
    return;
  }
  if (event.target !== svg) return;
  backgroundPan = { x: event.clientX, y: event.clientY, cameraX, cameraY };
  svg.setPointerCapture(event.pointerId);
  graphViewport.classList.add("panning");
});
function releasePan(event) {
  activePointers.delete(event.pointerId);
  pinchGesture = null;
  backgroundPan = null;
  if (activePointers.size === 1) {
    const point = [...activePointers.values()][0];
    backgroundPan = { ...point, cameraX, cameraY };
  } else {
    graphViewport.classList.remove("panning");
  }
}
svg.addEventListener("pointerup", releasePan);
svg.addEventListener("pointercancel", releasePan);
// A drag or pinch must never trigger a node click or reset the selection.
svg.addEventListener("click", event => {
  if (suppressBackgroundClick) {
    suppressBackgroundClick = false;
    event.stopImmediatePropagation();
    event.preventDefault();
  }
}, true);

svg.addEventListener("pointerup", releaseDrag);
svg.addEventListener("pointercancel", releaseDrag);
svg.addEventListener("click", (event) => {
  if (suppressBackgroundClick) {
    suppressBackgroundClick = false;
    return;
  }
  if (event.target === svg) {
    resetProfile({ restoreOverview: Boolean(pinnedResearcher) });
  }
});

nodes.forEach((node) => {
  node.element.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    draggingNode = node;
    dragStartScreen = { x: event.clientX, y: event.clientY };
    dragPointer = svgPoint(event);
    dragOffset = {
      x: node.x - dragPointer.x,
      y: node.y - dragPointer.y,
    };

    if (node.kind === "root") {
      userRootOverride = true;
      manualDetailPositions.clear();
    }

    node.element.classList.add("dragging");
    node.element.setPointerCapture(event.pointerId);
  });
});

const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(graphViewport);
resize();
document.fonts.ready.then(startGraph);

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

function wrapNodeLabel(label) {
  // Treat manual line breaks as word boundaries; never split a name inside a word.
  const words = label.replaceAll("\\n", " ").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  words.forEach(word => {
    if (line && line.length + word.length + 1 > 22) {
      lines.push(line);
      line = "";
    }
    line += (line ? " " : "") + word;
  });
  if (line) lines.push(line);
  return lines;
}

function writeNodeText(node) {
  const nodeType = detailOuterNodeType(node.kind);
  const isExternalLabel = Boolean(nodeType) || node.kind === "partner";
  const lines = isExternalLabel ? wrapNodeLabel(node.label) : node.label.split("\n");
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

  const nodeCaption = ["workplace", "lab", "preview"].includes(node.kind) ? "" : nodeType;
  if (nodeCaption) {
    const type = makeSvg("tspan", {
      x: "0",
      dy: "1.36em",
      class: "node-type",
    });
    type.textContent = nodeCaption;
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
  node.element.addEventListener("pointerenter", event => {
    if (event.pointerType === "touch" || event.buttons || draggingNode || backgroundPan || pinchGesture) return;
    if (node.element.getAttribute("aria-hidden") === "true" || pinnedInfoNode === node.id) return;
    // Hover changes only the card. Retain it on leave so its links remain usable.
    pinnedInfoNode = node.id;
    updateInfoCard();
  });
  node.element.addEventListener("click", () => {
    if (node.kind === "researcher") return;
    if (node.kind === "root") resetProfile();
    else {
      pinnedInfoNode = node.id;
      updateInfoCard();
    }
  });
}

function bindResearcherEvents(element, researcherId) {
  element.addEventListener("click", event => {
    event.stopPropagation();
    if (pinnedResearcher === researcherId) resetProfile();
    else selectProfileNode(nodeById.get(researcherId));
  });
  element.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (pinnedResearcher === researcherId) resetProfile();
    else selectProfileNode(nodeById.get(researcherId));
  });
}

function setPinnedResearcher(researcherId) {
  pinnedResearcher = researcherId;
  // Preserve the canvas unless the caller explicitly restores the overview.
  userRootOverride = !researcherId;
  manualDetailPositions.clear();
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
  const bounds = graphViewport.getBoundingClientRect();
  if (viewportReady && bounds.width === viewportWidth && bounds.height === viewportHeight) return;
  const oldCenter = { x: cameraX + viewportWidth / (2 * graphZoom), y: cameraY + viewportHeight / (2 * graphZoom) };
  viewportWidth = Math.max(1, bounds.width);
  viewportHeight = Math.max(1, bounds.height);
  const oldWidth = width;
  const oldHeight = height;
  width = Math.max(1400, viewportWidth);
  height = Math.max(1050, viewportHeight);
  const center = nodeById.get("nbri");
  if (!rootPositionReady) {
    center.x = width * 0.48;
    center.y = height * 0.51;
    rootPositionReady = true;
  } else if (width !== oldWidth || height !== oldHeight) {
    manualDetailPositions.clear();
  }
  applyGraphZoom(graphZoom, viewportReady ? oldCenter : center);
  viewportReady = true;
}

function updateCamera() {
  svg.setAttribute("viewBox", cameraX + " " + cameraY + " " + viewportWidth / graphZoom + " " + viewportHeight / graphZoom);
  graphViewport.style.backgroundSize = (24 * graphZoom) + "px " + (24 * graphZoom) + "px";
  graphViewport.style.backgroundPosition = (-cameraX * graphZoom) + "px " + (-cameraY * graphZoom) + "px";
  document.querySelector("#zoom-level").textContent = Math.round(graphZoom * 100) + "%";
  document.querySelector("#zoom-out").disabled = graphZoom <= 0.2;
  document.querySelector("#zoom-in").disabled = graphZoom >= 2.5;
}
function applyGraphZoom(zoom, center) {
  const anchor = center || {
    x: cameraX + viewportWidth / (2 * graphZoom),
    y: cameraY + viewportHeight / (2 * graphZoom),
  };
  graphZoom = clamp(zoom, 0.2, 2.5);
  cameraX = anchor.x - viewportWidth / (2 * graphZoom);
  cameraY = anchor.y - viewportHeight / (2 * graphZoom);
  updateCamera();
}
function zoomAt(zoom, screenPoint, anchor) {
  const world = anchor || { x: cameraX + screenPoint.x / graphZoom, y: cameraY + screenPoint.y / graphZoom };
  graphZoom = clamp(zoom, 0.2, 2.5);
  cameraX = world.x - screenPoint.x / graphZoom;
  cameraY = world.y - screenPoint.y / graphZoom;
  updateCamera();
}

function unobscuredFrame() {
  const viewport = graphViewport.getBoundingClientRect();
  const search = document.querySelector(".research-search").getBoundingClientRect();
  const profile = document.querySelector(".node-info").getBoundingClientRect();
  const heading = document.querySelector(".masthead").getBoundingClientRect();
  if (viewportWidth > 900) {
    const top = heading.bottom - viewport.top + 24;
    return {
      x: 24,
      y: top,
      width: Math.max(360, Math.min(search.left, profile.left) - viewport.left - 48),
      height: Math.max(240, viewportHeight - top - 70),
    };
  }
  const top = search.bottom - viewport.top + 16;
  return {
    x: 16,
    y: top,
    width: viewportWidth - 32,
    height: Math.max(120, profile.top - viewport.top - top - 16),
  };
}

function frameGraph(readable = false, { includeFiltered = false } = {}) {
  const activeId = activeResearcher();
  const opacityForFrame = includeFiltered ? baseNodeOpacity : nodeOpacity;
  const relevant = nodes.filter(node => opacityForFrame(node, activeId) > 0.12 &&
    (!activeId || nodeInFocusSubtree(node, activeId)));
  if (!relevant.length) return;
  const bounds = relevant.map(node => worldLayoutBox(node, node)).reduce(unionBox);
  const frame = unobscuredFrame();
  const scale = Math.min(frame.width / (bounds.width + 64), frame.height / (bounds.height + 64), 1);
  const focus = readable && scale < 0.85 && pinnedResearcher ? nodeById.get(pinnedResearcher) : null;
  zoomAt(readable ? Math.max(0.85, scale) : scale, {
    x: frame.x + frame.width / 2,
    y: frame.y + frame.height / 2,
  }, focus || {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  });
}

document.querySelector("#zoom-in").addEventListener("click", () => { applyGraphZoom(graphZoom + 0.15); });
document.querySelector("#zoom-out").addEventListener("click", () => { applyGraphZoom(graphZoom - 0.15); });
document.querySelector("#fit-graph").addEventListener("click", () => { frameGraph(); });
document.querySelector("#actual-size").addEventListener("click", () => { applyGraphZoom(1); });
graphViewport.addEventListener("wheel", event => {
  event.preventDefault();
  const bounds = svg.getBoundingClientRect();
  const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewportHeight : 1;
  zoomAt(graphZoom * Math.exp(-event.deltaY * units * 0.0015), { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
}, { passive: false });
graphViewport.addEventListener("keydown", event => {
  if (event.target !== graphViewport) return;
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
    event.preventDefault();
    cameraX += (event.key === "ArrowLeft" ? -60 : event.key === "ArrowRight" ? 60 : 0) / graphZoom;
    cameraY += (event.key === "ArrowUp" ? -60 : event.key === "ArrowDown" ? 60 : 0) / graphZoom;
    updateCamera();
  } else if (["+", "=", "-"].includes(event.key)) {
    event.preventDefault();
    applyGraphZoom(graphZoom + (event.key === "-" ? -0.15 : 0.15));
  } else if (event.key === "Home") {
    event.preventDefault();
    frameGraph();
  }
});

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
  nodes.forEach(updateNodeHitArea);
  seedPositions();
  updateInfoCard();
  settleLayout();
  frameGraph(Boolean(pinnedResearcher));
  render();
  // Flush the final hidden state so no opacity transition reveals seed positions.
  svg.getBoundingClientRect();
  svg.classList.add("is-ready");
  svg.setAttribute("aria-busy", "false");
  lastFrame = performance.now();
  requestAnimationFrame(tick);
}

function settleLayout() {
  // Run the initial force relaxation before presenting or framing a new branch.
  for (let step = 0; step < 180; step += 1) simulate(1);
}

function activeResearcher() {
  return pinnedResearcher;
}

function hoverPreviewAllowsOverflow() {
  return false;
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

function selectProfileNode(node) {
  setPinnedResearcher(node.kind === "researcher" ? node.id : node.owner || null);
  pinnedInfoNode = node.id;
  updateInfoCard();
  settleLayout();
  render();
  frameGraph(Boolean(pinnedResearcher));
}

function updateInfoCard() {
  const node = nodeById.get(pinnedInfoNode || pinnedResearcher || "nbri");
  window.renderNbriProfile(node, nodes, selectProfileNode);
}

function resetProfile({ restoreOverview = false } = {}) {
  setPinnedResearcher(null);
  pinnedInfoNode = null;
  updateInfoCard();
  if (restoreOverview) {
    // Rebuild the default overview before the next paint, including its camera.
    // Disable fading so expanded details cannot linger at their previous positions.
    svg.classList.add("is-resetting");
    searchIsOpen = false;
    searchBody.hidden = true;
    userRootOverride = false;
    Object.assign(nodeById.get("nbri"), defaultRootTarget());
    nodes.forEach(node => { node.vx = 0; node.vy = 0; });
    seedPositions();
    settleLayout();
    // Search still dims non-matches, but the camera returns to the full overview.
    frameGraph(false, { includeFiltered: true });
  } else {
    // Position the returning overview labels before they become visible.
    simulate(1);
  }
  render();
  if (restoreOverview) {
    svg.getBoundingClientRect();
    svg.classList.remove("is-resetting");
    lastFrame = performance.now();
  }
}

document.querySelector("#close-profile").addEventListener("click", () => {
  const previousNode = nodeById.get(pinnedResearcher || pinnedInfoNode);
  resetProfile();
  previousNode?.element.focus({ preventScroll: true });
});

const searchInput = document.querySelector("#research-search");
const searchResults = document.querySelector("#search-results");
const searchStatus = document.querySelector("#search-status");
const searchBody = document.querySelector("#search-body");
const domainOptions = document.querySelector("#domain-options");
const selectedDomains = new Set();
const researchers = nodes.filter(node => node.kind === "researcher");
let matchingResearcherIds = new Set(researchers.map(node => node.id));
let searchIsOpen = false;
const normalizeSearch = value => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const researchDomains = node => Array.isArray(node.info?.researchDomains)
  ? node.info.researchDomains.filter(domain => typeof domain === "string" && domain.trim()).map(domain => domain.trim()) : [];
const domains = [...new Set(researchers.flatMap(researchDomains))].sort();
domains.forEach(domain => {
  const label = document.createElement("label");
  label.className = "domain-option";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.value = domain;
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) selectedDomains.add(domain);
    else selectedDomains.delete(domain);
    searchIsOpen = true;
    updateSearch();
  });
  const name = document.createElement("span");
  name.textContent = domain;
  label.append(checkbox, name);
  domainOptions.append(label);
});

function updateSearch() {
  const query = normalizeSearch(searchInput.value.trim());
  const matches = researchers.filter(node => {
    const name = [node.label, node.info?.name].join(" ").replaceAll("\n", " ");
    return (!query || normalizeSearch(name).includes(query)) &&
      (!selectedDomains.size || researchDomains(node).some(domain => selectedDomains.has(domain)));
  });
  matchingResearcherIds = new Set(matches.map(node => node.id));
  if (pinnedResearcher && !matchingResearcherIds.has(pinnedResearcher)) resetProfile();
  const active = Boolean(query || selectedDomains.size);
  document.querySelector("#clear-filters").hidden = !active;
  searchStatus.textContent = matches.length ? "" : "No matches. Try another name or clear filters.";
  searchStatus.hidden = Boolean(matches.length);
  searchBody.hidden = !searchIsOpen || !active;

  searchResults.replaceChildren();
  (active ? matches : []).forEach(node => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-result";
    button.textContent = node.label.replaceAll("\n", " ");
    button.addEventListener("click", () => {
      searchInput.focus();
      searchIsOpen = false;
      searchBody.hidden = true;
      selectProfileNode(node);
    });
    searchResults.append(button);
  });
}
searchInput.addEventListener("input", () => { searchIsOpen = true; updateSearch(); });
searchInput.addEventListener("focus", () => { searchIsOpen = true; updateSearch(); });
document.querySelector("#clear-filters").addEventListener("click", () => {
  searchInput.value = "";
  selectedDomains.clear();
  domainOptions.querySelectorAll("input").forEach(input => { input.checked = false; });
  domainOptions.querySelectorAll(".domain-option").forEach(option => { option.hidden = false; });
  searchIsOpen = true;
  updateSearch();
  searchInput.focus();
});
searchInput.addEventListener("keydown", event => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    searchResults.querySelector("button")?.focus();
  }
  if (event.key === "Enter") searchResults.querySelector("button")?.click();
});
searchResults.addEventListener("keydown", event => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const next = event.key === "ArrowDown" ? event.target.nextElementSibling : event.target.previousElementSibling;
    (next || searchInput).focus();
  }
});
document.querySelector(".research-search").addEventListener("keydown", event => {
  if (event.key === "Escape") {
    event.preventDefault();
    searchInput.focus();
    searchIsOpen = false;
    searchBody.hidden = true;
  }
});
document.addEventListener("click", event => {
  if (!event.target.closest(".research-search")) {
    searchIsOpen = false;
    searchBody.hidden = true;
  }
});
updateSearch();

function matchesFilters(node) {
  const owner = node.kind === "researcher" ? node.id : node.owner;
  return !owner || matchingResearcherIds.has(owner);
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
  // Filtering changes emphasis, not the physical layout of the ecosystem.
  const visibleNodes = nodes.filter((node) => baseNodeOpacity(node, activeId) > 0.03);

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
    if (link.preview || link.detail || baseLinkOpacity(link, activeId) <= 0.03) {
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

    // Keep disappearing detail nodes in place throughout their opacity fade.
    if (baseNodeOpacity(node, activeId) <= 0.03) {
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

  if (openCandidate) return openCandidate.position;
  const textSafeCandidate = candidates.find(({ position }) =>
    !occupied.some(other => boxesOverlap(worldLayoutBox(node, position), other, 18)));
  if (textSafeCandidate) return textSafeCandidate.position;
  // Dense-data fallback: add canvas space instead of returning an overlapping anchor.
  const box = localLayoutBox(node);
  const position = { x: width + 32 - box.x, y: 80 - box.y };
  width += box.width + 80;
  userRootOverride = true;
  applyGraphZoom(graphZoom);
  return position;
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

function updateNodeHitArea(node) {
  if (!node.hitArea) return;
  // One continuous target covers the icon, every label line and surrounding space.
  // Measure after fonts load; keep the interaction padding out of the graph layout.
  const box = padBox(localLayoutBox(node), 4);
  const targetWidth = Math.max(44, box.width);
  const targetHeight = Math.max(44, box.height);
  node.hitArea.setAttribute("x", box.x - (targetWidth - box.width) / 2);
  node.hitArea.setAttribute("y", box.y - (targetHeight - box.height) / 2);
  node.hitArea.setAttribute("width", targetWidth);
  node.hitArea.setAttribute("height", targetHeight);
}

function safeTextBox(node) {
  try {
    if (node.measuredTextBox) return node.measuredTextBox;
    const box = node.text.getBBox();
    if (box.width || box.height) node.measuredTextBox = { x: box.x, y: box.y, width: box.width, height: box.height };
    return node.measuredTextBox || null;
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

    // Filtering must not move overview lab labels or change the reset bounds.
    if (baseNodeOpacity(other, activeId) <= 0.12) {
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
        baseLinkOpacity(link, activeId) <= 0.03 ||
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
    let labelOpacity = edgeLabelOpacity(link, activeId, opacity);
    const labelPoint = edgeLabelPoint(link);
    if (labelOpacity > 0 && edgeLabelOccupied.some(box =>
      boxesOverlap(edgeLabelBox(link, labelPoint), box, 6))) labelOpacity = 0;
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
    const detailIsInteractive = !node.detail || node.owner === pinnedResearcher;
    const interactive = opacity > 0.12 && detailIsInteractive;
    node.element.style.pointerEvents = interactive ? "auto" : "none";
    node.element.setAttribute("tabindex", interactive && node.kind === "researcher" ? "0" : "-1");
    node.element.setAttribute("aria-hidden", String(!interactive));
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
  return baseNodeOpacity(node, activeId) * (matchesFilters(node) ? 1 : 0.1);
}

function baseNodeOpacity(node, activeId) {
  if (node.detail) {
    return node.owner === activeId ? 1 : 0;
  }

  if (node.kind === "preview") {
    return activeId ? 0 : 0.44;
  }

  return activeId && !nodeInFocusSubtree(node, activeId) ? 0.16 : 1;
}

function linkOpacity(link, activeId) {
  return baseLinkOpacity(link, activeId) * (matchesFilters(link.sourceNode) && matchesFilters(link.targetNode) ? 1 : 0.1);
}

function baseLinkOpacity(link, activeId) {
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
    x: cameraX + (event.clientX - bounds.left) / graphZoom,
    y: cameraY + (event.clientY - bounds.top) / graphZoom,
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}
