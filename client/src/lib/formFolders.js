// Groups a flat list of form templates into a folder tree from each template's "/"-separated
// `folder` path (e.g. "OT Forms/Assessment Forms"). A template with no folder lands as an `item`
// directly on the root node. Folder names are trimmed and empty segments dropped, so "OT Forms/"
// and "OT Forms" land in the same node.
export function buildFolderTree(templates) {
  const root = { children: {}, items: [] };
  for (const t of templates) {
    const segments = (t.folder || '').split('/').map(s => s.trim()).filter(Boolean);
    let node = root;
    for (const seg of segments) {
      if (!node.children[seg]) node.children[seg] = { children: {}, items: [] };
      node = node.children[seg];
    }
    node.items.push(t);
  }
  return root;
}

// Sorted child folder names, then items sorted by name — file-explorer-style ordering.
export function sortedChildren(node) {
  return Object.keys(node.children).sort((a, b) => a.localeCompare(b));
}
export function sortedItems(node) {
  return [...node.items].sort((a, b) => a.name.localeCompare(b.name));
}

// Total template count under a node, including everything nested in its subfolders — used for
// an "(N)" hint on a collapsed folder header.
export function countItems(node) {
  let n = node.items.length;
  for (const child of Object.values(node.children)) n += countItems(child);
  return n;
}

// Every distinct folder path (and each of its parent prefixes) already in use, for a <datalist>
// autocomplete — reduces near-duplicate folder names from typos ("OT Forms" vs "OT forms").
export function folderPaths(templates) {
  const set = new Set();
  for (const t of templates) {
    const segments = (t.folder || '').split('/').map(s => s.trim()).filter(Boolean);
    for (let i = 1; i <= segments.length; i++) set.add(segments.slice(0, i).join('/'));
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
