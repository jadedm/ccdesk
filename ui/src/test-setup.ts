// jsdom implements no SVG layout, so the geometry methods mermaid calls while measuring a diagram
// do not exist. Without these, mermaid throws inside render, the Diagram component takes its error
// path, and a test waiting for an svg waits forever. Proved by running the real mermaid package
// against a bare jsdom: it fails on getBBox and, with these in place, returns a full svg.
//
// These are stubs, not a layout engine. A test may assert that a diagram rendered and what it
// contains; it may not assert anything about where a node sits or how large it is.
const geometry = {
  getBBox: () => ({ x: 0, y: 0, width: 100, height: 20 }),
  getComputedTextLength: () => 100,
  getSubStringLength: () => 100,
  getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse: () => geometry.getScreenCTM(), multiply: () => geometry.getScreenCTM() }),
};

// Defined unconditionally. Skipping any jsdom already provides would hand mermaid a method that
// throws, and the suite would report a fifteen second timeout rather than the real reason.
for (const [name, value] of Object.entries(geometry)) {
  Object.defineProperty(SVGElement.prototype, name, { value, writable: true, configurable: true });
}
