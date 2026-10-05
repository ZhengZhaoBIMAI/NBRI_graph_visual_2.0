// Each node kind has its own card fields. Member titles can be Master's Student,
// PhD Student or Postdoctoral Researcher; missing roles remain placeholders.
// researchDomains belong to search data only and are never rendered in cards.
const nbriProfileTemplates = {
  root: { website: true },
  researcher: { titlePlaceholder: "Academic Title", topics: true, social: true, website: true },
  member: { titlePlaceholder: "Member Role (Placeholder)", compact: true },
  lab: { labHead: true, website: true },
  preview: { labHead: true, website: true },
  collaborator: { titlePlaceholder: "Job Title (Placeholder)", affiliationKind: "workplace", affiliationLabel: "Company" },
  "academic-collaborator": { titlePlaceholder: "Academic Title (Placeholder)", affiliationKind: "university", affiliationLabel: "Institution", social: true },
  workplace: { website: true },
  university: { subtitleField: "faculty", subtitle: "Faculty of XX", website: true },
  partner: { subtitle: "Partner Organization", website: true },
  hub: { subtitle: "Research Group", website: true },
};

window.renderNbriProfile = function (node, graphNodes = window.nbriGraphData.nodes) {
  // An overview lab preview uses the same name and fields as its expanded node.
  if (node.kind === "preview") {
    node = graphNodes.find(candidate => candidate.kind === "lab" && candidate.owner === node.owner) || node;
  }
  const info = node.info || {};
  const researcher = node.kind === "researcher";
  const template = nbriProfileTemplates[node.kind] || { website: true };
  const card = document.querySelector(".node-info");
  card.classList.toggle("is-institute", node.kind === "root");
  card.classList.toggle("is-compact", Boolean(template.compact));
  card.dataset.nodeKind = node.kind;
  const clean = value => typeof value === "string" && value.trim() !== "xxx" ? value.trim() : "";
  const displayName = target => {
    const label = target.label.replaceAll("\n", " ");
    return target.kind === "researcher"
      ? label.replace(/^(Prof\.|Dr\.)\s*/, "")
      : ["lab", "preview"].includes(target.kind) ? label : clean(target.info?.name) || label;
  };
  document.querySelector("#info-name").textContent = displayName(node);
  const subtitle = document.querySelector("#info-subtitle");
  subtitle.textContent = template.titlePlaceholder
    ? clean(info.title) || template.titlePlaceholder
    : clean(info[template.subtitleField]) || template.subtitle || "";
  subtitle.hidden = !subtitle.textContent;
  document.querySelector("#close-profile").hidden = node.kind === "root";
  const fields = document.querySelector("#info-fields");
  const social = document.querySelector("#info-social");
  fields.replaceChildren();
  social.replaceChildren();
  social.hidden = true;

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) ? url : null;
    } catch { return null; }
  }
  function icon(path) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const shape = document.createElementNS(svg.namespaceURI, "path");
    shape.setAttribute("d", path);
    svg.append(shape);
    return svg;
  }
  function profileIcon(type, label, address) {
    const url = safeUrl(address);
    const element = document.createElement(url ? "a" : "span");
    element.className = "social-link social-" + type + (url ? "" : " is-placeholder");
    element.title = url ? label : label + " (placeholder)";
    element.setAttribute("aria-label", element.title);
    if (url) {
      element.href = url.href;
      element.target = "_blank";
      element.rel = "noopener noreferrer";
    } else {
      element.setAttribute("role", "img");
    }
    if (type === "linkedin") {
      const monogram = document.createElement("span");
      monogram.className = "linkedin-monogram";
      monogram.setAttribute("aria-hidden", "true");
      monogram.textContent = "in";
      element.append(monogram);
    } else {
      const scholar = icon("M1 9 12 2l11 7-11 7ZM5 13v5c4 4 10 4 14 0v-5l-7 4.5Z");
      scholar.classList.add("scholar-cap");
      element.append(scholar);
      const monogram = document.createElement("span");
      monogram.className = "scholar-monogram";
      monogram.setAttribute("aria-hidden", "true");
      monogram.textContent = "g";
      element.append(monogram);
    }
    social.append(element);
  }
  function field(label, content) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const value = document.createElement("dd");
    term.className = "panel-subheading";
    term.textContent = label;
    if (typeof content === "string") value.textContent = content;
    else value.append(content);
    row.append(term, value);
    fields.append(row);
  }
  if (template.social) {
    // Demo icons remain on researcher cards; collaborators show supplied links only.
    if (researcher || safeUrl(info.linkedin)) profileIcon("linkedin", "LinkedIn", info.linkedin);
    if (researcher || safeUrl(info.scholar)) profileIcon("scholar", "Google Scholar", info.scholar);
    social.hidden = !social.childElementCount;
  }
  if (template.topics) {
    const topics = Array.isArray(info.researchTopics)
      ? info.researchTopics.map(topic => clean(topic).replace(/[.\u3002]+$/, "").trim()).filter(Boolean)
      : [];
    const topicList = document.createElement("ul");
    topicList.className = "profile-topics";
    (topics.length ? topics : ["Research Topic 1", "Research Topic 2", "Research Topic 3"]).forEach(topic => {
      const item = document.createElement("li");
      item.textContent = topic;
      topicList.append(item);
    });
    field("Research Topics", topicList);
  }
  if (template.labHead) {
    const head = graphNodes.find(candidate => candidate.id === node.owner && candidate.kind === "researcher");
    field("Principal Investigator", head ? head.label.replaceAll("\n", " ") : "Researcher Name (Placeholder)");
  }
  if (template.affiliationKind) {
    const affiliationLink = window.nbriGraphData.links.find(link => link.source === node.id &&
      graphNodes.some(candidate => candidate.id === link.target && candidate.kind === template.affiliationKind));
    const affiliation = affiliationLink && graphNodes.find(candidate => candidate.id === affiliationLink.target);
    field(template.affiliationLabel, clean(info.affiliation) ||
      (affiliation ? displayName(affiliation) : template.affiliationLabel + " Name (Placeholder)"));
  }
  // Member and collaborator templates omit the Website field.
  if (!template.website) return;
  const websiteRow = document.createElement("span");
  websiteRow.className = "website-row";
  const url = safeUrl(info.website);
  if (url) {
    const website = document.createElement("a");
    website.href = url.href;
    website.target = "_blank";
    website.rel = "noopener noreferrer";
    website.textContent = url.hostname + (url.pathname === "/" ? "" : url.pathname);
    websiteRow.append(website);
  } else {
    const example = document.createElement("span");
    example.className = "website-placeholder";
    example.textContent = "www.examples.com";
    example.title = "Example website";
    websiteRow.append(example);
  }
  field("Website", websiteRow);
};
