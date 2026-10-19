// Dev tool (run in Node): regenerates src/defaultKeymap.js from the captured keymap file.
const fs = require('fs');
const SRC = process.env.APPDATA + '/TVPaint Animation 12 Pro Demo/default/keymaps/Fauxtoshop.cfg';
const DST = __dirname + '/../src/defaultKeymap.js';
const cfg = fs.readFileSync(SRC, 'utf8');
const out =
  "/* defaultKeymap.js — exact default shortcut map captured from this machine's TVPaint 12 Pro Demo\n" +
  ' * profile (%APPDATA%\\TVPaint Animation 12 Pro Demo\\default\\keymaps\\Fauxtoshop.cfg, ' + cfg.split(/\r?\n/).length + " lines).\n" +
  ' * Data (not code): the [Keyboard] section kept verbatim; tokenizer ignores locale-odd keys\n' +
  " * (mojibake like 'A?=?...' is tolerated; 'braquet' is kept as-is).\n" +
  ' * To regenerate: node tools/genDefaultKeymap.js\n' +
  ' */\n' +
  "(function (root, factory) {\n" +
  "  if (typeof module === 'object' && module.exports) { module.exports = factory(); }\n" +
  '  else { root.TVPDefaultKeymap = factory(); }\n' +
  '})(this, function () {\n' +
  '  return ' + JSON.stringify(cfg) + ';\n' +
  '});\n';
fs.writeFileSync(DST, out);
console.log('written', DST, cfg.split(/\r?\n/).length, 'lines');
