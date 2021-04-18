(() => {
    class OrganyaUI {
        /**
         * @param {HTMLCanvasElement} canvas 
         */
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext("2d");
            this.organya = null;
            this.scrollY = 8 * 144 - this.canvas.height;

            this.canvas.addEventListener("wheel", this.onScroll.bind(this));
            if ("ontouchstart" in window) {
                this.canvas.addEventListener('touchstart', this.onTouchStart.bind(this));
                this.canvas.addEventListener('touchmove', this.onTouchMove.bind(this));
                this.canvas.addEventListener('touchend', this.onTouchEnd.bind(this));
            }

            this.noteImg = new Image();
            this.noteImg.src = "Note.png";
            this.noteImg.addEventListener("load", this.onImageLoad.bind(this));
            this.pianoRoll = new Image();
            this.pianoRoll.src = "Music.png";
            this.pianoRoll.addEventListener("load", this.onImageLoad.bind(this));
            this.number = new Image();
            this.number.src = "Number.png";
            this.number.addEventListener("load", this.onImageLoad.bind(this));
        }

        onTouchStart(e) {
            this.touching = true;
            this.touchX = e.touches[0].pageX;
            this.touchY = e.touches[0].pageY;
        }

        onTouchMove(e) {
            if (this.touching) {
                //const offX = this.touchX - e.touches[0].pageX;
                const offY = this.touchY - e.touches[0].pageY;
                this.touchX = e.touches[0].pageX;
                this.touchY = e.touches[0].pageY;

                this.onScroll({deltaY: offY});
            }
        }

        onTouchEnd() {
            this.touching = false;
            this.touchX = 0;
            this.touchY = 0;
        }

        onScroll(e) {
            this.scrollY += e.deltaY;
            this.draw();
        }

        onImageLoad() {
            if (this.noteImg.complete && this.pianoRoll.complete) {
                this.draw();
            }
        }

        /**
         * Sets the reference to Organya player used by this instance of renderer.
         * @param {Organya} organya 
         */
        setOrganya(organya) {
            this.organya = organya;
            console.log(organya.song);
            this.organya.onUpdate = this.draw.bind(this);
        }

        drawNumber(x, y, number, zeroPad = 0, white = false) {
            let str = number.toString();
            while (str.length < zeroPad) {
                str = "0" + str;
            }

            for (let i = 0; i < str.length; i++) {
                this.ctx.drawImage(this.number, (str.charCodeAt(i) - 0x30) * 8, white ? 12 : 0, 8, 12, x, y, 8, 12);
                x += 8;
            }
        }

        draw() {
            const { width, height } = this.canvas;
            this.ctx.clearRect(0, 0, width, height);

            const maxY = 8 * 144 - this.canvas.height;
            if (this.scrollY < 0) this.scrollY = 0;
            if (this.scrollY > maxY) this.scrollY = maxY;

            const meas = this.organya ? this.organya.song.meas : [4, 4];
            const startMeas = this.organya ? (this.organya.playPos / (meas[0] * meas[1]) | 0) : 0;

            let y = -this.scrollY;
            while (y < height) {
                let beat = 0;
                let subBeat = 0;
                let x = 64;
                let measId = startMeas;
                while (x < width) {
                    let sprX = 96;
                    if (subBeat === 0) sprX = 80;
                    if (subBeat === 0 && beat === 0) {
                        sprX = 64;
                        this.drawNumber(x, 0, measId++, 3);
                    }

                    if (++subBeat === meas[1]) {
                        subBeat = 0;
                        if (++beat === meas[0]) beat = 0;
                    }

                    this.ctx.drawImage(this.pianoRoll, sprX, 0, 16, 144, x, y, 16, 144);
                    x += 16;
                }

                y += 144;
            }

            if (this.organya) {
                const viewPos = startMeas * meas[0] * meas[1];
                const scrollX = viewPos * 16 - 64;

                // draw tails
                trackLoop: for (let track = 7; track > 0; track--) {
                    const trackRef = this.organya.song.tracks[track];
                    let noteIdx = Math.max(0, trackRef.findIndex((n) => n.pos >= viewPos) - 1);
                    if (noteIdx === -1) continue;

                    const sprTailX = 32;
                    const sprTailY = 32 + track * 4;

                    let x = 64;
                    while (x < width) {
                        const note = trackRef[noteIdx++];
                        if (!note) continue trackLoop;

                        const noteX = note.pos * 16 - scrollX;
                        const noteY = (95 - note.key) * 12 - this.scrollY;

                        x = noteX;
                        for (let i = 0; i < note.len; i++) {
                            this.ctx.drawImage(this.noteImg, sprTailX, sprTailY, 16, 4, noteX + i * 16, noteY + 4, 16, 4);
                            x += 16;
                        }
                    }
                }

                trackLoop: for (let track = 15; track > 0; track--) {
                    const trackRef = this.organya.song.tracks[track];
                    let noteIdx = Math.max(0, trackRef.findIndex((n) => n.pos >= viewPos) - 1);
                    if (noteIdx === -1) continue;

                    const sprHeadX = (track & 1) * 16;
                    const sprHeadY = 48 + (track / 2 | 0) * 8;
                    
                    let x = 64;
                    while (x < width) {
                        const note = trackRef[noteIdx++];
                        if (!note) continue trackLoop;

                        const noteX = note.pos * 16 - scrollX;
                        const noteY = (95 - note.key) * 12 - this.scrollY;

                        x = noteX;
                        for (let i = 0; i < note.len; i++) x += 16;

                        this.ctx.drawImage(this.noteImg, sprHeadX, sprHeadY, 16, 8, noteX, noteY + 3, 16, 8);
                    }
                }
            }

            let octave = 7;
            y = -this.scrollY;
            while (y < height) {
                this.ctx.drawImage(this.pianoRoll, 0, 0, 64, 144, 0, y, 64, 144);
                this.drawNumber(54, y + 132, octave, 0, true);
                if (octave-- === 0) break;
                y += 144;
            }
        }
    }

    window.OrganyaUI = OrganyaUI;
})();