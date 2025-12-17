/**
 * CAR ENTITY
 * Handles Player and Bot physics, movement, and intersection logic.
 */
class Car {
    constructor(network, isBot = false, avoidPoint = null) {
        this.network = network;
        this.isBot = isBot;
        
        // Settings
        this.color = isBot ? "#ff003c" : "#00f3ff";
        this.maxSpeed = isBot ? 20 : 35;
        this.acceleration = 0.3;
        this.friction = 0.96;
        
        // Configuration for visual trail length
        this.maxTrailLength = 40; 

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

        this.spawn(avoidPoint);
    }

    /**
     * Resets car state and places it on a road.
     * @param {Object} avoidPoint - Optional {x, y} coordinates to stay away from during spawn.
     */
    spawn(avoidPoint = null) {
        if (!this.network.roads.length) return;

        let spawnRoad = null;
        const minDistance = 500;

        if (avoidPoint) {
            // Find roads with start points outside the exclusion radius
            const candidates = this.network.roads.filter(road => {
                const d = Utils.dist(road.points[0], avoidPoint);
                return d > minDistance;
            });

            if (candidates.length > 0) {
                spawnRoad = candidates[Math.floor(Math.random() * candidates.length)];
            }
        }

        // Fallback to random road if no candidates found
        if (!spawnRoad) {
            spawnRoad = this.network.roads[Math.floor(Math.random() * this.network.roads.length)];
        }

        this.currentRoad = spawnRoad;
        this.pointIndex = 0;
        this.t = 0;
        this.x = this.currentRoad.points[0].x;
        this.y = this.currentRoad.points[0].y;
        this.trail = [{ x: this.x, y: this.y }];
        this.speed = 0; 
        this.crashed = false;
    }

    update(input) {
        if (this.crashed) return;

        // 1. Input / AI Physics
        if (!this.isBot && input) {
            if (input.accelerating) this.speed += this.acceleration;
            else if (input.braking) this.speed -= this.acceleration * 1.5;
        } else {
            if (this.speed < this.maxSpeed) this.speed += this.acceleration;
        }

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
        
        if (!intersection || !intersection.outgoing.length) {
            if (this.isBot) {
                const playerPos = (input && input.player) ? { x: input.player.x, y: input.player.y } : null;
                this.spawn(playerPos);
                return;
            }
            this.crashed = true;
            this.crashReason = "DEAD END";
            return;
        }

        let candidates = intersection.outgoing.filter(r => r.id !== this.currentRoad.reverseId);
        if (candidates.length === 0) candidates = intersection.outgoing;

        let bestRoad = candidates[0];

        if (this.isBot) {
            const sensorData = input || {};
            const player = sensorData.player;
            const otherBots = sensorData.bots;

            let attractionAngle = 0;
            let hasAttraction = false;
            
            if (player && !player.crashed) {
                attractionAngle = Utils.angleTo(this, player);
                hasAttraction = true;
            }

            let repulsionAngle = 0;
            let repulsionStrength = 0;
            const detectionRadius = 300; 

            if (otherBots) {
                let closestDist = Infinity;
                let closestBot = null;
                for (const b of otherBots) {
                    if (b === this) continue;
                    const d = Utils.dist({x: this.x, y: this.y}, {x: b.x, y: b.y});
                    if (d < closestDist) {
                        closestDist = d;
                        closestBot = b;
                    }
                }
                if (closestBot && closestDist < detectionRadius) {
                    repulsionAngle = Utils.angleTo(closestBot, this);
                    repulsionStrength = 1 - (closestDist / detectionRadius);
                }
            }

            let totalWeight = 0;
            const weightedOptions = candidates.map(road => {
                let weight = 1;
                if (hasAttraction) {
                    const diff = Math.abs(Utils.angleDiff(road.startAngle, attractionAngle));
                    weight += (1 - (diff / Math.PI)) * 10;
                }
                if (repulsionStrength > 0) {
                    const diff = Math.abs(Utils.angleDiff(road.startAngle, repulsionAngle));
                    weight += (1 - (diff / Math.PI)) * 50 * repulsionStrength; 
                }
                totalWeight += weight;
                return { road, weight };
            });

            let randomValue = Math.random() * totalWeight;
            for (const option of weightedOptions) {
                randomValue -= option.weight;
                if (randomValue <= 0) {
                    bestRoad = option.road;
                    break;
                }
            }
        } else {
            let minAngleDiff = Infinity;
            for (const road of candidates) {
                const diff = Math.abs(Utils.angleDiff(input.mouseAngle, road.startAngle));
                if (diff < minAngleDiff) {
                    minAngleDiff = diff;
                    bestRoad = road;
                }
            }
        }

        const turnAngle = Math.abs(Utils.angleDiff(this.angle, bestRoad.startAngle));
        this.speed *= Math.max(0.2, 1 - (turnAngle / Math.PI) * 1.5);

        this.currentRoad = bestRoad;
        this.pointIndex = 0;
        this.t = 0;
    }

    checkCollision(otherCar, avoidPoint = null) {
        if (this.crashed || otherCar === this) return;

        // Head-on check
        if (!otherCar.crashed && Utils.dist({x: this.x, y: this.y}, {x: otherCar.x, y: otherCar.y}) < 8) {
            this.crashed = true;
            this.crashReason = "HEAD-ON COLLISION";
            otherCar.crashed = true;
            otherCar.crashReason = "HEAD-ON COLLISION";
            if (this.isBot && otherCar.isBot) {
                this.spawn(avoidPoint);
                otherCar.spawn(avoidPoint);
            }
            return;
        }

        // Trail check
        if (otherCar.trail.length < 2) return;
        for (let i = 0; i < otherCar.trail.length; i++) {
            const p = otherCar.trail[i];
            if (p && Utils.dist({x: this.x, y: this.y}, p) < 4) { 
                this.crashed = true;
                this.crashReason = "TRACE COLLISION";
                if (this.isBot && otherCar.isBot) this.spawn(avoidPoint);
                return;
            }
        }
    }
}