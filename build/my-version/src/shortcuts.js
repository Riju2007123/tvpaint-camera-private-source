/* TVPShortcuts — TVPaint-style keyboard shortcuts: parse / edit / serialize the exact
 * keymap file format (SPEC.md §8).
 *
 * Exact format evidence (Windows profile of TVPaint 12 Pro Demo):
 *   %APPDATA%\TVPaint Animation 12 Pro Demo\default\keymaps\Fauxtoshop.cfg
 *     [Keyboard] section, one binding per line:
 *       <Combo>=<Action>            e.g. "Ctrl Z=Undo", "A=SelectShapePolygone"
 *       <Combo>=none                action not bound to that combo
 *   Combo tokens separated by spaces: Shift, Ctrl, then a key token. Key token may be a
 *   literal char (A..Z, 0..9, punctuation), F1..F12, "Pad N" (Ctrl Pad 0..9), "Wheel Up",
 *   "Wheel Down", "Page Up", "Page Down", or odd tokens kept verbatim ("braquet").
 *   In-binary support strings (this EXE): mShortcutKey* (colors/state), "Export Shortcuts"
 *   (0x140a6ab78), ConfigureKeyboard action bound to Ctrl K in the default map.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.TVPShortcuts = factory(); }
})(this, function () {
  // Combo token → normalized chord (kept tolerant: unknown tokens preserved verbatim)
  function parseCombo(text) {
    const parts = String(text).trim().split(/\s+/);
    const chord = { ctrl: false, shift: false, key: '' };
    for (const p of parts) {
      const low = p.toLowerCase();
      if (low === 'ctrl') chord.ctrl = true;
      else if (low === 'shift') chord.shift = true;
      else chord.key = p === 'braquet' ? 'braquet' : p; // keep odd tokens verbatim except case
    }
    return chord;
  }
  function comboText(chord) {
    const pre = [];
    if (chord.ctrl) pre.push('Ctrl');
    if (chord.shift) pre.push('Shift');
    return pre.concat([chord.key]).join(' ');
  }

  /** Parse the [Keyboard] file. Returns { section, bindings: [{comboText, chord, action, raw}] }. */
  function parseKeymap(text) {
    const out = { section: null, bindings: [] };
    for (const rawLine of String(text).split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      if (/^\[.*\]$/.test(line)) { out.section = line; continue; }
      const eq = line.indexOf('=');
      if (eq < 1) continue;                             // tolerate locale-mojibake lines
      const combo = line.slice(0, eq).trim();
      const action = line.slice(eq + 1).trim();
      if (!combo || /[^A-Za-z0-9 =+\-*/<>!;:.~"'\\&|`'^?()[\]{}@$§]/.test(combo)) continue; // drop mojibake keys
      out.bindings.push({ comboText: combo, chord: parseCombo(combo), action, raw: rawLine });
    }
    return out;
  }

  /** Serialize bindings back to the exact [Keyboard] format. */
  function serializeKeymap(bindings) {
    const lines = ['[Keyboard]'];
    for (const b of bindings) lines.push(b.comboText + '=' + (b.action || 'none'));
    return lines.join('\r\n') + '\r\n';
  }

  /** Find duplicate bindings for the same action (nice UX parity with "ShortcutKeyInUse"). */
  function conflicts(bindings) {
    const by = new Map();
    for (const b of bindings) {
      const k = comboText(b.chord).replace(/\s+/g, ' ').toLowerCase();
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(b);
    }
    return [...by.values()].filter(v => v.length > 1);
  }

  /** Bindings matching a search text — parity of the settings panel search colors. */
  function search(bindings, text) {
    const t = text.trim().toLowerCase();
    return bindings.filter(b =>
      b.comboText.toLowerCase().includes(t) || b.action.toLowerCase().includes(t));
  }

  /** Set (or replace) an action binding. */
  function bind(bindings, comboTextStr, action) {
    const chord = parseCombo(comboTextStr);
    for (const b of bindings) {
      if (comboText(b.chord) === comboText(chord)) { b.action = action || 'none'; b.comboText = comboText(chord); return b; }
    }
    const nb = { comboText: comboText(chord), chord, action: action || 'none', raw: null };
    bindings.push(nb);
    return nb;
  }

  return { parseKeymap, serializeKeymap, parseCombo, comboText, conflicts, search, bind };
});
