/**
 * CAR ENTITY
 * Handles Player and Bot physics, movement, and intersection logic.
 */
class Car {
    constructor(network, isBot = false) {
        this.network = network;
        this.isBot = isBot;
        
        // Settings
        this.color = isBot ? "#ff003c" : "#00f3ff"; // Red for bots, Cyan for player
        this.maxSpeed = isBot ? 20 : 35; // Bots are slightly slower
        this.acceleration = 0.3;
        this.friction = 0.96;
        
        // CONFIG: Change this value to make trails longer or shorter
        this.maxTrailLength = 100; 

        // State
        this.currentRoad = null;
        this.pointIndex = 0; 
        this.t = 0;          
        this.speed = 0;
        this.x = 0;
        this.y = 0;
        this.angle = 0;
        
        this.trail = [];
        this.crashed = false;
        this.crashReason = "";

        this.spawn();
    }

    spawn() {
        if (this.network.roads.length === 0) return;
        this.currentRoad = this.network.roads[Math.floor(Math.random() * this.network.roads.length)];
        this.pointIndex = 0;
        this.t = 0;
        this.x = this.currentRoad.points[0].x;
        this.y = this.currentRoad.points[0].y;
        this.trail = [{x: this.x, y: this.y}];
        
        // Bots start moving immediately
        if (this.isBot) this.speed = this.maxSpeed * 0.8; 
        
        // Reset crash state
        this.crashed = false;
    }

    update(input) {
        if (this.crashed) return;

        // 1. Input / AI Physics
        if (!this.isBot && input) {
            // Player Control
            if (input.accelerating) this.speed += this.acceleration;
            else if (input.braking) this.speed -= this.acceleration * 1.5;
        } else {
            // Bot Control (Maintain Cruise Speed)
            if (this.speed < this.maxSpeed) this.speed += this.acceleration;
        }

        // Global Friction & Clamping
        this.speed *= this.friction;
        if (this.speed < 0) this.speed = 0;

        if (this.speed < 0.1) return;

        // 2. Move along Geometry
        const p1 = this.currentRoad.points[this.pointIndex];
        const p2 = this.currentRoad.points[this.pointIndex + 1];
        const segmentLen = Utils.dist(p1, p2);
        
        const step = segmentLen > 0 ? this.speed / segmentLen : 1;
        this.t += step;

        this.x = Utils.lerp(p1.x, p2.x, this.t);
        this.y = Utils.lerp(p1.y, p2.y, this.t);
        this.angle = Utils.angleTo(p1, p2);

        // Trail Logic
        const lastTrail = this.trail[this.trail.length - 1];
        if (Utils.dist(lastTrail, {x: this.x, y: this.y}) > 5) {
            this.trail.push({x: this.x, y: this.y});
            
            // Limit trail length based on configuration
            if (this.trail.length > this.maxTrailLength) this.trail.shift(); 
        }

        // 3. Segment End Check
        if (this.t >= 1) {
            this.t = 0;
            this.pointIndex++;
            if (this.pointIndex >= this.currentRoad.points.length - 1) {
                this.handleIntersection(input);
            }
        }
    }

    handleIntersection(input) {
        const intersection = this.network.nodes[this.currentRoad.endNodeIdx];
        
        // Dead End Logic
        if (!intersection || !intersection.outgoing.length) {
            if (this.isBot) {
                this.spawn(); // Bots respawn on dead ends
                return;
            }
            this.crashed = true;
            this.crashReason = "DEAD END";
            return;
        }

        // Available Roads (Filter out immediate U-turn unless it's the only way)
        let candidates = intersection.outgoing.filter(r => r.id !== this.currentRoad.reverseId);
        if (candidates.length === 0) candidates = intersection.outgoing;

        let bestRoad = null;

        if (this.isBot) {
            // BOT AI: Pick random valid road
            bestRoad = candidates[Math.floor(Math.random() * candidates.length)];
        } else {
            // PLAYER: Pick based on mouse angle
            let minAngleDiff = Infinity;
            for (const road of candidates) {
                const diff = Math.abs(Utils.angleDiff(input.mouseAngle, road.startAngle));
                if (diff < minAngleDiff) {
                    minAngleDiff = diff;
                    bestRoad = road;
                }
            }
        }

        // TURNING PHYSICS: Slow down based on turn sharpness
        const currentAbsAngle = this.angle;
        const newAbsAngle = bestRoad.startAngle;
        const turnAngle = Math.abs(Utils.angleDiff(currentAbsAngle, newAbsAngle));

        const penalty = Math.max(0.2, 1 - (turnAngle / Math.PI) * 1.5);
        this.speed *= penalty;

        this.currentRoad = bestRoad;
        this.pointIndex = 0;
        this.t = 0;
    }

    checkCollision(otherCar) {
        if (this.crashed) return;

        // Ignore self-collision logic
        if (otherCar === this) return;

        // 1. HEAD-ON COLLISION CHECK (Body to Body)
        // Distance threshold ~10 (Car is drawn as 10px long)
        if (!otherCar.crashed && Utils.dist({x: this.x, y: this.y}, {x: otherCar.x, y: otherCar.y}) < 10) {
            this.crashed = true;
            this.crashReason = "HEAD-ON COLLISION";
            
            // Crash the other car as well
            otherCar.crashed = true;
            otherCar.crashReason = "HEAD-ON COLLISION";

            // If bots are involved, respawn them
            if (this.isBot) this.spawn();
            if (otherCar.isBot) otherCar.spawn();
            
            return;
        }

        // 2. TRAIL COLLISION CHECK (Body to Trail)
        // Skip if the other car has no trail
        if (otherCar.trail.length < 2) return;
        
        const limit = otherCar.trail.length;

        for (let i = 0; i < limit; i++) {
            const p = otherCar.trail[i];
            
            // Safety check in case of array sync issues
            if (!p) continue;

            if (Utils.dist({x: this.x, y: this.y}, p) < 4) { 
                this.crashed = true;
                this.crashReason = "TRACE COLLISION";
                
                // If a bot crashes, respawn it instantly elsewhere
                if (this.isBot) {
                    this.spawn();
                }
                return;
            }
        }
    }
}