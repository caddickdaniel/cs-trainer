const { expect } = require('chai');
const zlib = require('zlib');
const { reseed, signIn, signUp, tacticDoc, teamWithMember } = require('./helpers');

// Builds a valid PNG of the given size (solid colour).
function png(width = 4, height = 3) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height, 0x80);
  for (let y = 0; y < height; y += 1) raw[y * (width * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const uploadAs = (who, teamId, body, type = 'image/png') =>
  who.post(`/api/teams/${teamId}/lineup-images`).set('Content-Type', type).send(body);

describe('lineup screenshots and map levels', () => {
  beforeEach(reseed);

  it('leads upload PNGs; members can view them; others cannot', async () => {
    const { owner, member, teamId } = await teamWithMember();
    const { body } = await uploadAs(owner, teamId, png(1920, 1080)).expect(201);
    expect(body.image).to.include({ width: 1920, height: 1080 });
    const url = `/api/lineup-images/${body.image.image_id}`;
    const res = await member.get(url).buffer(true).parse((r, cb) => {
      const parts = []; r.on('data', (d) => parts.push(d)); r.on('end', () => cb(null, Buffer.concat(parts)));
    }).expect(200);
    expect(res.headers['content-type']).to.equal('image/png');
    expect(res.headers['cache-control']).to.include('private');
    expect(res.body.equals(png(1920, 1080))).to.equal(true);
    await (await signIn('A')).get(url).expect(404);
    await member.get('/api/lineup-images/not-a-uuid').expect(404);
  });

  it('rejects uploads from members, non-PNGs, oversized and empty bodies', async () => {
    const { owner, member, teamId } = await teamWithMember();
    await uploadAs(member, teamId, png()).expect(403);
    await uploadAs(await signUp('Outsider'), teamId, png()).expect(404);
    expect((await uploadAs(owner, teamId, Buffer.from('GIF89a not a png at all, definitely not'), 'image/png').expect(415)).body.code).to.equal('not_png');
    expect((await uploadAs(owner, teamId, Buffer.from('xx'), 'image/jpeg').expect(415)).body.code).to.equal('not_png');
    expect((await uploadAs(owner, teamId, png(9000, 10)).expect(400)).body.code).to.equal('image_too_large');
    const huge = Buffer.concat([png(), Buffer.alloc(9 * 1024 * 1024)]);
    await uploadAs(owner, teamId, huge).expect(413);
    await owner.agent.post(`/api/teams/${teamId}/lineup-images`).set('Content-Type', 'image/png').send(png()).expect(403); // no CSRF token
  });

  it('attaches screenshots to utility markers and carries them into Game Mode', async () => {
    const { owner, member, teamId } = await teamWithMember();
    const img = (await uploadAs(owner, teamId, png()).expect(201)).body.image.image_id;
    const doc = tacticDoc([owner.user.user_id, member.user.user_id], { map: 'de_nuke' });
    doc.phases[0].board.markers[1] = {
      id: 'm2', kind: 'smoke', x: 0.4, y: 0.3, level: 'lower', user_id: member.user.user_id, label: 'Ramp smoke',
      images: [{ image_id: img, caption: 'Stand in the corner' }],
    };
    const { tactic } = (await owner.post(`/api/teams/${teamId}/tactics`).send(doc).expect(201)).body;
    const saved = tactic.phases[0].board.markers.find((m) => m.id === 'm2');
    expect(saved).to.include({ level: 'lower' });
    expect(saved.images).to.deep.equal([{ image_id: img, caption: 'Stand in the corner' }]);
    expect(tactic.phases[0].board.markers[0].level).to.equal('main');

    await owner.post(`/api/teams/${teamId}/game-session`).send({ tactic_id: tactic.tactic_id }).expect(201);
    const live = (await member.get(`/api/teams/${teamId}/game-session`).expect(200)).body.session;
    expect(live.tactic.map).to.equal('de_nuke');
    expect(live.phase.board.markers.find((m) => m.id === 'm2').images[0].image_id).to.equal(img);
  });

  it('rejects screenshots on player markers and images from another team', async () => {
    const { owner, member, teamId } = await teamWithMember();
    const ids = [owner.user.user_id, member.user.user_id];
    const other = await teamWithMember();
    const foreign = (await uploadAs(other.owner, other.teamId, png()).expect(201)).body.image.image_id;
    const mine = (await uploadAs(owner, teamId, png()).expect(201)).body.image.image_id;

    const onPlayer = tacticDoc(ids);
    onPlayer.phases[0].board.markers[0].images = [{ image_id: mine }];
    await owner.post(`/api/teams/${teamId}/tactics`).send(onPlayer).expect(400);

    const stolen = tacticDoc(ids);
    stolen.phases[0].board.markers[1].images = [{ image_id: foreign }];
    const { body } = await owner.post(`/api/teams/${teamId}/tactics`).send(stolen).expect(400);
    expect(body).to.include({ code: 'image_not_found' });
    expect(body.image_ids).to.deep.equal([foreign]);
  });

  it('accepts lower-level items only on maps that have a lower level', async () => {
    const { owner, member, teamId } = await teamWithMember();
    const ids = [owner.user.user_id, member.user.user_id];
    for (const map of ['de_nuke', 'de_train', 'de_vertigo']) {
      const d = tacticDoc(ids, { map });
      d.phases[0].board.routes[0].level = 'lower';
      await owner.post(`/api/teams/${teamId}/tactics`).send(d).expect(201);
    }
    const bad = tacticDoc(ids, { map: 'de_mirage' });
    bad.phases[0].board.routes[0].level = 'lower';
    const { body } = await owner.post(`/api/teams/${teamId}/tactics`).send(bad).expect(400);
    expect(body.issues[0].message).to.equal('de_mirage has no lower level');
    await owner.post(`/api/teams/${teamId}/tactics`).send(tacticDoc(ids, { map: 'de_dust2' })).expect(201);
  });
});
