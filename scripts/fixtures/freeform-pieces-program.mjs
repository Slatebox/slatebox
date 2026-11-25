// The program the canvas conversation's model wrote on test.slatebox.com (exec run 87e905c8, 2026-11-25) for the
// builder request "snappable congruent pieces to compose new printable materials", verbatim but for the slate id.
// Its 28-operation plan gave no add_nodes a count (the declarations never said count was required) and named
// connect_nodes' new connectors with connectionIds; slates.applyOperations refused it with 400 invalid_operation_plan.
export const LOGGED_REQUEST = "snappable congruent pieces to compose new printable materials";
export const loggedProgram = (shareId) => `const slate = await slatebox.slates.get({shareId: ${JSON.stringify(shareId)}});
const revision = slate.revision;
const ops = [];
const pieceStyle = {backgroundColor: "#BFDBFE", borderColor: "#2563EB", borderWidth: 2, foregroundColor: "#1E3A5F", fontSize: 28, textXAlign: "middle", textYAlign: "middle"};
function addPiece(id, x, y, text) {
  const op = {kind: "add_nodes", ids: [id], shape: "rectangle", x, y, width: 100, height: 100, style: pieceStyle};
  if (text !== undefined) op.text = text;
  ops.push(op);
}
function addText(id, text, x, y, width, height, size, color) {
  ops.push({kind: "add_nodes", ids: [id], preset: "text", text, x, y, width, height, style: {foregroundColor: color || "#111827", fontSize: size || 16, textXAlign: "left", textYAlign: "middle", fontFamily: "Manrope"}});
}
function connect(id, from, to) {
  ops.push({kind: "connect_nodes", from: {ids: [from]}, to: {ids: [to]}, connectionIds: [id], style: {lineColor: "#6B7280", lineWidth: 2}});
}
ops.push({kind: "add_nodes", ids: ["kit_title"], shape: "roundedrectangle", text: "Snappable Congruent Pieces - Printable Materials Kit", x: 0, y: 0, width: 880, height: 64, style: {backgroundColor: "#1E3A5F", borderColor: "#1E3A5F", borderWidth: 0, foregroundColor: "#FFFFFF", fontSize: 22, textXAlign: "middle", textYAlign: "middle", fontFamily: "Manrope"}});
addText("kit_instructions", "Print at 100% and cut on the border. Every piece is identical (100 x 100) - snap edges together with no gaps to compose new printable templates.", 0, 76, 880, 48, 15, "#374151");
addText("kit_label", "THE KIT - 9 congruent pieces (interchangeable)", 0, 132, 320, 32, 16);
for (let i = 0; i < 9; i++) {
  const row = Math.floor(i / 3);
  const col = i % 3;
  addPiece("kit_" + (i + 1), col * 100, 170 + row * 100, String(i + 1));
}
addText("ex_square_label", "COMPOSE 1 - 2 x 2 snap square (4 pieces)", 380, 132, 420, 32, 16);
addPiece("ex_a1", 380, 170);
addPiece("ex_a2", 480, 170);
addPiece("ex_a3", 380, 270);
addPiece("ex_a4", 480, 270);
addText("ex_strip_label", "COMPOSE 2 - 1 x 4 snap strip (4 pieces)", 380, 410, 420, 32, 16);
addPiece("ex_b1", 380, 446);
addPiece("ex_b2", 480, 446);
addPiece("ex_b3", 580, 446);
addPiece("ex_b4", 680, 446);
addText("kit_footer", "To compose a new printable: copy the same 100 x 100 piece, snap it edge-to-edge to the last piece, and print the outline as a stencil or worksheet template.", 0, 560, 880, 56, 15, "#374151");
connect("conn_kit_label", "kit_label", "kit_1");
connect("conn_k1_k2", "kit_1", "kit_2");
connect("conn_k1_k4", "kit_1", "kit_4");
connect("conn_square_label", "ex_square_label", "ex_a1");
connect("conn_strip_label", "ex_strip_label", "ex_b1");
const result = await slatebox.slates.applyOperations({
  shareId: ${JSON.stringify(shareId)},
  userMessage: "snappable congruent pieces to compose new printable materials",
  expectedRevision: revision,
  plan: {
    message: "Added a printable kit of 9 identical 100 x 100 snappable squares (snap edge-to-edge, no gaps) plus two example compositions - a 2 x 2 snap square and a 1 x 4 snap strip - with labels and print/cut instructions, so the same congruent pieces can be copied and recomposed into new printable templates.",
    operations: ops
  }
});
return {ok: result.ok, revision: result.revision, outcome: result.outcome, message: result.message, operations: ops.length};`;
