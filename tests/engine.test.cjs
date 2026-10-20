const assert = require('node:assert/strict');
const { encodeSplicedWav, formatTime, estimateBpm } = require('../.engine-test-build/audio.js');
const { findCandidates } = require('../.engine-test-build/smart-cut.js');

function audioFixture(rate=8000, seconds=18) {
  const length = rate * seconds;
  const channels = [new Float32Array(length), new Float32Array(length)];
  for (let i = 0; i < length; i++) {
    const t = i / rate;
    const value = 0.25 * Math.sin(t * 2 * Math.PI * 220) + 0.15 * Math.sin(t * 2 * Math.PI * 330);
    channels[0][i] = value;
    channels[1][i] = value * 0.85;
  }
  return { length, duration: seconds, sampleRate: rate, numberOfChannels: 2, getChannelData: (i) => channels[i] };
}

async function run() {
  const audio = audioFixture();
  assert.equal(formatTime(65.5), '01:05');
  const exact = findCandidates(audio, { mode:'exact', selection:{start:3.5,end:9.5}, mpm:32, beatsPerBar:4, searchBars:1 });
  assert.equal(exact.length,1);
  assert.equal(exact[0].removed,6);
  const ballroom = findCandidates(audio, { mode:'ballroom', selection:{start:3.3,end:11.3}, mpm:32, beatsPerBar:4, searchBars:1 });
  assert.ok(ballroom.length >= 1);
  for (const suggestion of ballroom) {
    if (suggestion.score === 0) continue;
    const nBars = suggestion.removed / (60 / 32);
    assert.ok(Math.abs(nBars-Math.round(nBars)) < 1e-6, 'deleted duration contains whole bars');
    assert.equal(Math.round(nBars), Math.round(8 / (60 / 32)), 'search must preserve the requested bar count');
  }
  const smart = findCandidates(audio, { mode:'smart', selection:{start:3.3,end:11.3}, mpm:32, beatsPerBar:4, searchBars:2 });
  for (const suggestion of smart) {
    assert.ok(Math.abs(suggestion.removed - Math.round(8 / (60 / 32 / 4)) * (60 / 32 / 4)) < 1e-6,
      'search must preserve the requested beat count');
  }
  const uncut = new DataView(await encodeSplicedWav(audio, 0, 0, 0).arrayBuffer());
  assert.equal(uncut.getUint32(40,true), audio.length * 4, 'zero-length cut preserves every sample');
  const wav = encodeSplicedWav(audio, 3, 8, 120);
  const data = new DataView(await wav.arrayBuffer());
  assert.equal(wav.type,'audio/wav');
  assert.equal(data.getUint32(24,true),8000);
  assert.equal(data.getUint16(22,true),2);
  assert.equal(data.getUint32(40,true),13*8000*4, 'crossfade must not change expected duration');
  assert.equal(wav.size,44+13*8000*4);
  for (const fade of [0, 10, 70, 200]) {
    const rendered = new DataView(await encodeSplicedWav(audio, 3, 8, fade).arrayBuffer());
    assert.equal(rendered.getUint32(40,true), 13*8000*4);
    // Samples outside the blend must keep their precise source positions.
    const quantize = (v) => Math.trunc(v < 0 ? v * 32768 : v * 32767);
    for (const frame of [1000, 25001, 80001]) {
      const sourceFrame = frame < 24000 ? frame : frame + 40000;
      assert.equal(rendered.getInt16(44 + frame * 4,true), quantize(audio.getChannelData(0)[sourceFrame]));
    }
  }
  assert.ok(estimateBpm(audio) === null || Number.isFinite(estimateBpm(audio)));
  console.log('PASS: exact cut, musical bar grid, WAV channels/header, fixed timeline length');
}
run().catch((err)=>{console.error(err);process.exitCode=1;});
