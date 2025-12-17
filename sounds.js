/**
 * AUDIO CONTROLLER
 * Handles generative sound synthesis using Web Audio API.
 * No external samples required.
 */
class SoundController {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        
        // Player Engine Nodes
        this.playerEngine = null;

        // Bot Engine Pool (Polyphony)
        this.botEngines = [];
        this.MAX_BOT_VOICES = 5; // Maximum number of simultaneous bot engine sounds

        // State Tracking
        this.initialized = false;
        
        // For event detection
        this.lastAngle = 0;
        this.crashedStates = new Map(); // Track which cars are already crashed
    }

    async init() {
        if (this.initialized) return;

        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
        
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 1.0; // Master Volume
        this.masterGain.connect(this.ctx.destination);

        // Setup Player Engine
        this.playerEngine = this.createEngineGraph();
        this.startEngine(this.playerEngine);

        // Setup Pool of Bot Engines
        for (let i = 0; i < this.MAX_BOT_VOICES; i++) {
            const engine = this.createEngineGraph();
            this.startEngine(engine);
            this.botEngines.push(engine);
        }

        this.initialized = true;

        // Resume context if suspended (browser policy)
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }
    }

    /**
     * Creates the audio graph for a single car engine.
     * Consists of dual oscillators, modulation, and filtering.
     */
    createEngineGraph() {
        // Dual Oscillator for richer engine drone
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const engineGain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        // Low rumble
        osc1.type = 'sawtooth';
        osc1.frequency.value = 40; 

        // Higher harmonic
        osc2.type = 'square';
        osc2.frequency.value = 80;
        osc2.detune.value = 10; // Slight detune for phasing effect

        // Modulation for "purr"
        const modulator = this.ctx.createOscillator();
        modulator.frequency.value = 10; // 10Hz rattle
        const modGain = this.ctx.createGain();
        modGain.gain.value = 20;

        // Graph Connections
        modulator.connect(modGain);
        modGain.connect(osc1.frequency);
        
        osc1.connect(engineGain);
        osc2.connect(engineGain);
        
        // Lowpass filter to muffle the raw waveforms
        filter.type = 'lowpass';
        filter.frequency.value = 200;
        
        engineGain.connect(filter);
        filter.connect(this.masterGain);

        // Initialize silent
        engineGain.gain.value = 0;

        return { osc1, osc2, modulator, engineGain, filter };
    }

    startEngine(engine) {
        engine.osc1.start();
        engine.osc2.start();
        engine.modulator.start();
    }

    /**
     * Updates pitch and volume of a specific engine graph based on car physics.
     */
    updateEngineSound(engine, speedRatio, volumeScale, t) {
        // Pitch mapping: 0 speed -> 10Hz
        const targetFreq = 10 + (speedRatio * 600);
        
        engine.osc1.frequency.setTargetAtTime(targetFreq, t, 0.1);
        engine.osc2.frequency.setTargetAtTime(targetFreq * 2.02, t, 0.1);

        // Volume mapping: Idle -> 0.1, Moving -> 0.4
        // Scaled by distance/priority (volumeScale)
        const baseVol = 0.05 + (speedRatio * 0.3);
        const finalVol = baseVol * volumeScale;
        
        engine.engineGain.gain.setTargetAtTime(finalVol, t, 0.1);

        // Filter opening: Idle -> 200Hz, Fast -> 1000Hz
        const targetFilter = 200 + (speedRatio * 1500);
        engine.filter.frequency.setTargetAtTime(targetFilter, t, 0.1);
    }

    update(player, bots) {
        if (!this.initialized || !player) return;

        const t = this.ctx.currentTime;
        const playerSpeedRatio = player.speed / player.maxSpeed;

        // 1. UPDATE PLAYER ENGINE
        const playerVol = player.crashed ? 0 : 1.0;
        this.updateEngineSound(this.playerEngine, playerSpeedRatio, playerVol, t);

        // 2. UPDATE BOT ENGINES
        // Find closest bots to render their engines
        const activeBots = bots
            .map(bot => ({ 
                bot, 
                dist: Utils.dist(player, bot) 
            }))
            .filter(item => !item.bot.crashed && item.dist < 800) // Audible range
            .sort((a, b) => a.dist - b.dist)
            .slice(0, this.MAX_BOT_VOICES);

        // Assign to pool
        for (let i = 0; i < this.MAX_BOT_VOICES; i++) {
            const voice = this.botEngines[i];
            
            if (i < activeBots.length) {
                const { bot, dist } = activeBots[i];
                const botSpeedRatio = bot.speed / bot.maxSpeed;
                
                // Distance attenuation (Linear fade out)
                const distanceGain = Math.max(0, 1 - (dist / 800));
                
                this.updateEngineSound(voice, botSpeedRatio, distanceGain, t);
            } else {
                // Unused voice - silence it
                voice.engineGain.gain.setTargetAtTime(0, t, 0.1);
            }
        }

        // 3. TURN SOUNDS (Player Only)
        const angleDiff = Math.abs(Utils.angleDiff(player.angle, this.lastAngle));
        if (player.speed > 0 && angleDiff > 0.05) {
            this.playTireScreech(angleDiff, playerSpeedRatio);
        }
        this.lastAngle = player.angle;

        // 4. CRASH DETECTION (Player & Bots)
        const allCars = [player, ...bots];
        allCars.forEach(car => {
            const wasCrashed = this.crashedStates.get(car);

            if (car.crashed && !wasCrashed) {
                // New Crash!
                const distToPlayer = Utils.dist(player, car);
                this.playCrash(distToPlayer);
            }
            
            // Update state
            this.crashedStates.set(car, car.crashed);
        });
    }

    playTireScreech(intensity, speedRatio) {
        if (this.ctx.state !== 'running') return;
        
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        // Tire screech logic
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(600 + (speedRatio * 400), t);
        osc.frequency.exponentialRampToValueAtTime(400, t + 0.2);

        gain.gain.setValueAtTime(0.1 * intensity, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(t);
        osc.stop(t + 0.2);
    }

    playCrash(distance) {
        if (this.ctx.state !== 'running') return;

        const t = this.ctx.currentTime;
        
        // Distance attenuation
        // Increased range (2000) so off-screen bot crashes are audible
        let volume = Math.max(0, 1 - (distance / 2000)); 
        
        // Skip if too quiet/far to save processing
        if (volume <= 0.001) return; 

        // Non-linear fade for better loudness perception at distance
        volume = Math.pow(volume, 1.5);

        // 1. NOISE BURST (The "Crunch")
        // Create a buffer for white noise
        const bufferSize = this.ctx.sampleRate * 0.5; // 0.5 seconds
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * 0.8; 
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        
        // Filter noise to sound like heavy impact (Lowpass sweep)
        const noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'lowpass';
        noiseFilter.frequency.setValueAtTime(1000, t); // Start crunchy
        noiseFilter.frequency.exponentialRampToValueAtTime(100, t + 0.4);

        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(volume, t);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.masterGain);
        noise.start(t);

        // 2. SYNTH BASS DROP (The "Deepness")
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth'; // Gritty synth texture
        osc.frequency.setValueAtTime(120, t); // Start frequency (Impact punch)
        osc.frequency.exponentialRampToValueAtTime(30, t + 0.5); // Drop to sub-bass

        const oscGain = this.ctx.createGain();
        oscGain.gain.setValueAtTime(volume * 0.8, t);
        oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);

        osc.connect(oscGain);
        oscGain.connect(this.masterGain);

        osc.start(t);
        osc.stop(t + 0.6);
    }
}