import { test } from 'node:test';
import assert from 'node:assert/strict';

import { escAttr, escHtml, htmlLabel, num, emit } from '../src/emit.js';
import { createIdAllocator } from '../src/ids.js';
import { resolveColor, knownThemeIDs } from '../src/themes.js';
import { sqlTableLabel, classLabel, iconUrl } from '../src/special.js';

test('escAttr escapes XML attribute metacharacters', () => {
  assert.equal(escAttr('a & b < c > d " e'), 'a &amp; b &lt; c &gt; d &quot; e');
  assert.equal(escAttr('line1\nline2'), 'line1&#10;line2');
  assert.equal(escAttr('crlf\r\nend'), 'crlf&#10;end');
});

test('escHtml escapes HTML content characters only', () => {
  assert.equal(escHtml('a & b < c > d'), 'a &amp; b &lt; c &gt; d');
  assert.equal(escHtml('"quotes stay"'), '"quotes stay"');
});

test('htmlLabel escapes then converts newlines to <br>', () => {
  assert.equal(htmlLabel('x < y\nsecond'), 'x &lt; y<br>second');
});

test('num keeps coordinates readable', () => {
  assert.equal(num(136.39999389648438), '136.4');
  assert.equal(num(42), '42');
  assert.equal(num(-71.005), '-71');
});

test('id allocator sanitizes, dedupes, and avoids reserved ids', () => {
  const idFor = createIdAllocator();
  assert.equal(idFor('core.pull'), 'core_pull');
  assert.equal(idFor('core.pull'), 'core_pull');
  assert.equal(idFor('core pull'), 'core_pull_2');
  assert.equal(idFor('"x.y"'), '_x_y_');
  assert.equal(idFor('0'), 'n_0');
  assert.equal(idFor('1'), 'n_1');
  assert.equal(idFor(''), 'n_');
  const other = createIdAllocator();
  assert.equal(other('core.pull'), 'core_pull');
});

test('resolveColor passes literals through and resolves theme codes', () => {
  assert.equal(resolveColor('#FF0000'), '#FF0000');
  assert.equal(resolveColor('red'), 'red');
  assert.equal(resolveColor('transparent'), 'none');
  assert.equal(resolveColor('none'), 'none');
  // Verified palette values for theme 0 (Neutral Default) and 200 (Dark Mauve).
  assert.equal(resolveColor('B1', 0), '#0D32B2');
  assert.equal(resolveColor('N1', 0), '#0A0F25');
  assert.equal(resolveColor('N7', 0), '#FFFFFF');
  assert.equal(resolveColor('B1', 200), '#CBA6f7');
  // Unknown theme falls back to theme 0.
  assert.equal(resolveColor('B1', 99999), '#0D32B2');
  // Codes that do not exist in the palette pass through.
  assert.equal(resolveColor('B7', 0), 'B7');
});

test('all 20 official themes are present', () => {
  assert.equal(knownThemeIDs().length, 20);
  assert.ok(knownThemeIDs().includes(0));
  assert.ok(knownThemeIDs().includes(200));
  assert.ok(knownThemeIDs().includes(303));
});

test('emit produces the minimal valid skeleton', () => {
  const xml = emit([{ name: 'P1', cells: [] }]);
  assert.match(xml, /^<mxfile host="app.diagrams.net" type="device">/);
  assert.match(xml, /<diagram id="page-1" name="P1">/);
  assert.match(xml, /<mxCell id="0"\/><mxCell id="1" parent="0"\/>/);
  assert.match(xml, /<\/mxGraphModel><\/diagram><\/mxfile>\n$/);
});

test('emit wraps cells with tooltips or links in object elements', () => {
  const xml = emit([
    {
      name: 'P1',
      cells: [
        {
          id: 'a',
          value: 'A',
          style: 'rounded=0;',
          parent: '1',
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          tooltip: 'hover me',
          link: 'https://example.com',
        },
      ],
    },
  ]);
  assert.match(
    xml,
    /<object label="A" tooltip="hover me" link="https:\/\/example.com" id="a"><mxCell style="rounded=0;" vertex="1" parent="1">/
  );
});

test('emit renders fixed-endpoint edges without source/target', () => {
  const xml = emit([
    {
      name: 'P1',
      cells: [
        {
          id: 'e0',
          value: '',
          style: 'edgeStyle=none;',
          parent: '1',
          edge: true,
          sourcePoint: { x: 1, y: 2 },
          targetPoint: { x: 3, y: 4 },
          points: [{ x: 2, y: 3 }],
        },
      ],
    },
  ]);
  assert.match(xml, /<mxPoint x="1" y="2" as="sourcePoint"\/>/);
  assert.match(xml, /<mxPoint x="3" y="4" as="targetPoint"\/>/);
  assert.match(xml, /<Array as="points"><mxPoint x="2" y="3"\/><\/Array>/);
  assert.doesNotMatch(xml, /source="/);
});

test('emit renders multiple pages with stable ids', () => {
  const xml = emit([
    { name: 'one', cells: [] },
    { name: 'two', cells: [] },
  ]);
  assert.match(xml, /<diagram id="page-1" name="one">/);
  assert.match(xml, /<diagram id="page-2" name="two">/);
});

test('emit sets background and math flags per page', () => {
  const xml = emit([{ name: 'P', cells: [], background: '#FFFFFF', math: true }]);
  assert.match(xml, /math="1"/);
  assert.match(xml, /background="#FFFFFF"/);
  const plain = emit([{ name: 'P', cells: [], background: 'none' }]);
  assert.doesNotMatch(plain, /background=/);
});

test('sqlTableLabel formats columns with constraint tags', () => {
  const label = sqlTableLabel(
    {
      label: 'users',
      columns: [
        { name: { label: 'id' }, type: { label: 'int' }, constraint: ['primary_key'] },
        { name: { label: 'note' }, type: { label: 'text <raw>' }, constraint: null },
      ],
    },
    '#0A0F25'
  );
  assert.match(label, /<font color="#0A0F25"><b>users<\/b><\/font><hr>/);
  assert.match(label, /id: int&nbsp;&nbsp;<i>PK<\/i>/);
  assert.match(label, /note: text &lt;raw&gt;/);
});

test('classLabel formats visibility and members', () => {
  const label = classLabel({
    label: 'Parser',
    fields: [{ name: 'pos', type: 'int', visibility: 'private', underline: false }],
    methods: [{ name: 'peek()', return: 'Token', visibility: 'public', underline: false }],
  });
  assert.match(label, /- pos: int/);
  assert.match(label, /\+ peek\(\): Token/);
});

test('iconUrl rebuilds URLs from Go net/url objects', () => {
  assert.equal(
    iconUrl({
      Scheme: 'https',
      Host: 'icons.terrastruct.com',
      Path: '/essentials/112-server.svg',
      RawPath: '/essentials%2F112-server.svg',
      RawQuery: '',
      Fragment: '',
    }),
    'https://icons.terrastruct.com/essentials%2F112-server.svg'
  );
  assert.equal(iconUrl(null), null);
});
