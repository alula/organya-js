(() => {
    let waveTable = new Int8Array(new ArrayBuffer(0));
    let drums = [];

    class Song {
        /**
         * @param {ArrayBuffer} data 
         */
        constructor(data) {
            const view = new DataView(data);
            let p = 0;

            // Org-
            const org1 = view.getUint32(p, true); p += 4;
            if (org1 != 0x2d67724f) {
                throw "Invalid magic.";
            }

            const orgVersion = view.getUint16(p, true); p += 2;
            if (orgVersion != 0x3230) {
                throw "Invalid version.";
            }

            this.wait = view.getUint16(p, true); p += 2;
            this.meas = [view.getUint8(p++, true), view.getUint8(p++, true)];
            this.start = view.getInt32(p, true); p += 4;
            this.end = view.getInt32(p, true); p += 4;

            this.instruments = [];

            for (let i = 0; i < 16; i++) {
                const freq = view.getInt16(p, true); p += 2;
                const wave = view.getUint8(p, true); p++;
                const pipi = view.getUint8(p, true); p++;
                const notes = view.getUint16(p, true); p += 2;

                this.instruments[i] = { freq, wave, pipi, notes };
            }

            this.tracks = [];
            for (let i = 0; i < 16; i++) {
                const track = [];
                track.length = this.instruments[i].notes;

                for (let j = 0; j < this.instruments[i].notes; j++)
                    track[j] = { pos: 0, key: 0, len: 0, vol: 0, pan: 0 };

                for (let j = 0; j < this.instruments[i].notes; j++) {
                    track[j].pos = view.getInt32(p, true); p += 4;
                }

                for (let j = 0; j < this.instruments[i].notes; j++) {
                    track[j].key = view.getUint8(p, true); p++;
                }

                for (let j = 0; j < this.instruments[i].notes; j++) {
                    track[j].len = view.getUint8(p, true); p++;
                }

                for (let j = 0; j < this.instruments[i].notes; j++) {
                    track[j].vol = view.getUint8(p, true); p++;
                }

                for (let j = 0; j < this.instruments[i].notes; j++) {
                    track[j].pan = view.getUint8(p, true); p++;
                }

                this.tracks[i] = track;
            }
        }
    }

    const freqTable = [261, 278, 294, 311, 329, 349, 371, 391, 414, 440, 466, 494];
    const panTable = [0, 43, 86, 129, 172, 215, 256, 297, 340, 383, 426, 469, 512];
    const advTable = [1, 1, 2, 2, 4, 8, 16, 32];
    const octTable = [32, 64, 64, 128, 128, 128, 128, 128];

    class Organya {
        /**
         * @param {ArrayBuffer} data 
         */
        constructor(data) {
            this.song = new Song(data);
            this.node = null;
            this.onUpdate = null;
            this.t = 0;
            this.playPos = 0;
            this.samplesPerTick = 0;
            this.samplesThisTick = 0;
            this.state = [];
            for (let i = 0; i < 16; i++) {
                this.state[i] = {
                    t: 0,
                    key: 0,
                    frequency: 0,
                    octave: 0,
                    pan: 0.0,
                    vol: 1.0,
                    length: 0,
                    num_loops: 0,
                    playing: false,
                    looping: false,
                };
            }
        }

        /**
         * @param {Float32Array} leftBuffer 
         * @param {Float32Array} rightBuffer
         */
        synth(leftBuffer, rightBuffer) {
            for (let sample = 0; sample < leftBuffer.length; sample++) {
                if (this.samplesThisTick == 0) this.update();

                leftBuffer[sample] = 0;
                rightBuffer[sample] = 0;

                for (let i = 0; i < 16; i++) {
                    if (this.state[i].playing) {
                        const samples = (i < 8) ? 256 : drums[i - 8].samples;

                        this.state[i].t += (this.state[i].frequency / this.sampleRate) * advTable[this.state[i].octave];

                        if ((this.state[i].t | 0) >= samples) {
                            if (this.state[i].looping && this.state[i].num_loops != 1) {
                                this.state[i].t %= samples;
                                if (this.state[i].num_loops != 1)
                                    this.state[i].num_loops -= 1;

                            } else {
                                this.state[i].t = 0;
                                this.state[i].playing = false;
                                continue;
                            }
                        }

                        const t = this.state[i].t & ~(advTable[this.state[i].octave] - 1);
                        let pos = t % samples;
                        let pos2 = !this.looping && t == samples ?
                            pos
                            : ((this.state[i].t + advTable[this.state[i].octave]) & ~(advTable[this.state[i].octave] - 1)) % samples;
                        const s1 = i < 8
                            ? (waveTable[256 * this.song.instruments[i].wave + pos] / 256)
                            : (((waveTable[drums[i - 8].filePos + pos] & 0xff) - 0x80) / 256);
                        const s2 = i < 8
                            ? (waveTable[256 * this.song.instruments[i].wave + pos2] / 256)
                            : (((waveTable[drums[i - 8].filePos + pos2] & 0xff) - 0x80) / 256);
                        const fract = (this.state[i].t - pos) / advTable[this.state[i].octave];

                        // perform linear interpolation
                        let s = s1 + (s2 - s1) * fract;

                        s *= Math.pow(10, ((this.state[i].vol - 255) * 8) / 2000);

                        const pan = (panTable[this.state[i].pan] - 256) * 10;
                        let left = 1, right = 1;

                        if (pan < 0) {
                            right = Math.pow(10, pan / 2000);
                        } else if (pan > 0) {
                            left = Math.pow(10, -pan / 2000);
                        }

                        leftBuffer[sample] += s * left;
                        rightBuffer[sample] += s * right;
                    }
                }

                if (++this.samplesThisTick == this.samplesPerTick) {
                    this.playPos += 1;
                    this.samplesThisTick = 0;

                    if (this.playPos == this.song.end) {
                        this.playPos = this.song.start;
                    }
                }
            }
        }

        update() {
            if (this.onUpdate) this.onUpdate(this);

            for (let track = 0; track < 8; track++) {
                const note = this.song.tracks[track].find((n) => n.pos == this.playPos);
                if (note) {
                    if (note.key != 255) {
                        const octave = ((note.key / 12) | 0);
                        const key = note.key % 12;

                        if (this.state[track].key == 255) {
                            this.state[track].key = note.key;

                            this.state[track].frequency = freqTable[key] * octTable[octave] + (this.song.instruments[track].freq - 1000);
                            if (this.song.instruments[track].pipi != 0 && !this.state[track].playing) {
                                this.state[track].num_loops = ((octave + 1) * 4);
                            }
                        } else if (this.state[track].key != note.key) {
                            this.state[track].key = note.key;
                            this.state[track].frequency = freqTable[key] * octTable[octave] + (this.song.instruments[track].freq - 1000);
                        }

                        if (this.song.instruments[track].pipi != 0 && !this.state[track].playing) {
                            this.state[track].num_loops = ((octave + 1) * 4);
                        }

                        this.state[track].octave = octave;
                        this.state[track].playing = true;
                        this.state[track].looping = true;
                        this.state[track].length = note.len;
                    }

                    if (this.state[track].key != 255) {
                        if (note.vol != 255) this.state[track].vol = note.vol;
                        if (note.pan != 255) this.state[track].pan = note.pan;
                    }
                }

                if (this.state[track].length == 0) {
                    if (this.state[track].key != 255) {
                        if (this.song.instruments[track].pipi == 0)
                            this.state[track].looping = false;

                        this.state[track].playing = false;
                        this.state[track].key = 255;
                    }
                } else {
                    this.state[track].length--;
                }
            }

            for (let track = 8; track < 16; track++) {
                const note = this.song.tracks[track].find((n) => n.pos == this.playPos);
                if (!note) continue;

                if (note.key != 255) {
                    this.state[track].frequency = note.key * 800 + 100;
                    this.state[track].t = 0;
                    this.state[track].playing = true;
                }

                if (note.vol != 255) this.state[track].vol = note.vol;
                if (note.pan != 255) this.state[track].pan = note.pan;
            }
        }

        stop() {
            this.node.disconnect();
            this.ctx.close();
        }

        play() {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.sampleRate = this.ctx.sampleRate;
            this.samplesPerTick = (this.sampleRate / 1000) * this.song.wait | 0;
            this.samplesThisTick = 0;

            this.node = this.ctx.createScriptProcessor(8192, 0, 2);
            this.node.onaudioprocess = (e) => this.synth(e.outputBuffer.getChannelData(0), e.outputBuffer.getChannelData(1));
            this.node.connect(this.ctx.destination);
        }
    }

    window.initOrganya = async () => {
        if (window.Organya) return;

        console.log("Initializing Organya...");
        const res = await fetch("wavetable.bin");
        const buf = await res.arrayBuffer();
        const view = new DataView(buf);
        waveTable = new Int8Array(buf);

        for (let i = 256 * 100; i < waveTable.length - 4; i++) {
            if (view.getUint32(i, true) == 0x45564157) {
                i += 4;
                const riffId = view.getUint32(i, true); i += 4;
                const riffLen = view.getUint32(i, true); i += 4;
                if (riffId != 0x20746d66) {
                    console.error("Invalid RIFF chunk ID");
                    continue;
                }

                const startPos = i;
                const aFormat = view.getUint16(i, true); i += 2;
                if (aFormat != 1) {
                    console.error("Invalid audio format");
                    i = startPos + riffLen;
                    continue;
                }

                const channels = view.getUint16(i, true); i += 2;
                if (channels != 1) {
                    console.error("Only 1 channel files are supported");
                    i = startPos + riffLen;
                    continue;
                }

                const samples = view.getUint32(i, true); i += 10; // skip rate + padding
                const bits = view.getUint16(i, true); i += 2;
                const wavData = view.getUint32(i, true); i += 4;
                const wavLen = view.getUint32(i, true); i += 4;

                if (wavData != 0x61746164) {
                    i = startPos + riffLen;
                    continue;
                }

                drums.push({ filePos: i, bits, channels, samples: wavLen });
                i += wavLen;
            }
        }

        window.Organya = Organya;
    };
})();