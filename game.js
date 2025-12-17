/**
 * MAIN GAME CONTROLLER
 */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});

const network = new RoadNetwork();
const input = new InputHandler();
const sound = new SoundController();

let player = null;
let bots = [];
let cameraZoom = 1;
let isGameRunning = false;
let animationFrameId = null; 
let lastTime = 0;
const FPS_LIMIT = 60;
const FRAME_MIN_TIME = 1000 / FPS_LIMIT;
let smoothSpeedKmh = 0;
let mapBounds = null;

let currentMapUrl = 'maps/pula.json';
let currentBotCount = 0;

const menu = document.getElementById('menu');
const startBtn = document.getElementById('startBtn');
const mapInput = document.getElementById('mapInput');
const botInput = document.getElementById('botInput');

startBtn.addEventListener('click', () => {
    const map = mapInput.value;
    const count = parseInt(botInput.value) || 0;
    menu.style.display = 'none';
    initGame(map, count);
});

window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && isGameRunning) {
        stopGame();
        menu.style.display = 'flex';
    }
});

const handleRestart = (e) => {
    if (!isGameRunning) return;
    if (e.type === 'mousedown' && e.button !== 0) return;

    if (player && player.crashed) {
        player = new Car(network, false);
        const playerPos = { x: player.x, y: player.y };
        bots = [];
        for (let i = 0; i < currentBotCount; i++) {
            bots.push(new Car(network, true, playerPos));
        }
        smoothSpeedKmh = 0;
    }
};

canvas.addEventListener('mousedown', handleRestart);
canvas.addEventListener('touchstart', handleRestart);

async function initGame(mapUrl, botCount) {
    stopGame();
    await sound.init();

    currentMapUrl = mapUrl;
    currentBotCount = botCount;
    smoothSpeedKmh = 0;
    
    try {
        await network.load(currentMapUrl);
        
        // Calculate map boundaries based on all road points
        mapBounds = network.roads.reduce((acc, road) => {
            road.points.forEach(p => {
                if (p.x < acc.minX) acc.minX = p.x;
                if (p.x > acc.maxX) acc.maxX = p.x;
                if (p.y < acc.minY) acc.minY = p.y;
                if (p.y > acc.maxY) acc.maxY = p.y;
            });
            return acc;
        }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
        
    } catch (err) {
        console.error(err);
        alert("Failed to load map.");
        menu.style.display = 'flex';
        return;
    }

    player = new Car(network, false);
    const playerPos = { x: player.x, y: player.y };
    
    bots = [];
    for (let i = 0; i < currentBotCount; i++) {
        bots.push(new Car(network, true, playerPos));
    }

    isGameRunning = true;
    lastTime = performance.now();
    loop(lastTime);
}

function stopGame() {
    isGameRunning = false;
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
}

function loop(currentTime) {
    animationFrameId = requestAnimationFrame(loop);
    if (!isGameRunning) return;

    const deltaTime = currentTime - lastTime;
    if (deltaTime < FRAME_MIN_TIME) return;

    lastTime = currentTime - (deltaTime % FRAME_MIN_TIME);
    
    const playerPos = player ? { x: player.x, y: player.y } : null;

    // 1. Update Phase
    if (player) {
        player.update(input);
        bots.forEach(bot => player.checkCollision(bot, playerPos));
    }

    bots.forEach(bot => {
        bot.update({ player, bots }); 
        if (player && !player.crashed) bot.checkCollision(player, playerPos);
        bots.forEach(otherBot => {
            if (bot !== otherBot) bot.checkCollision(otherBot, playerPos);
        });
    });

    bots = bots.filter(bot => !bot.crashed);

    if (player) sound.update(player, bots);

    // 2. Camera Logic
    const targetZoom = player ? 3.0 / (1 + (player.speed * 0.3)) : 1;
    cameraZoom = Utils.lerp(cameraZoom, targetZoom, 0.05);

    // 3. Render Phase
    ctx.fillStyle = "#0d0221";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    let camX = 0, camY = 0;
    if (player) {
        camX = player.x;
        camY = player.y;
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(cameraZoom, cameraZoom);
        ctx.translate(-player.x, -player.y);
    }

    // DRAW MAP BOUNDARIES
    if (mapBounds) {
        ctx.strokeStyle = "#ff003c";
        ctx.lineWidth = 10 / cameraZoom; // Keep line width consistent visually
        ctx.setLineDash([20, 20]); // Dashed border aesthetic
        ctx.strokeRect(
            mapBounds.minX,
            mapBounds.minY,
            mapBounds.maxX - mapBounds.minX,
            mapBounds.maxY - mapBounds.minY
        );
        ctx.setLineDash([]); // Reset dash for subsequent drawing
    }

    // DRAW MAP
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#1a1a40"; 
    ctx.lineCap = "round";
    const viewW = canvas.width / cameraZoom;
    const viewH = canvas.height / cameraZoom;
    const visibleRoads = network.getRoadsInRect(camX - viewW/2 - 500, camY - viewH/2 - 500, camX + viewW/2 + 500, camY + viewH/2 + 500);

    ctx.beginPath();
    for (const road of visibleRoads) {
        ctx.moveTo(road.points[0].x, road.points[0].y);
        for (let i = 1; i < road.points.length; i++) ctx.lineTo(road.points[i].x, road.points[i].y);
    }
    ctx.stroke();

    const entities = [...bots, player];

    entities.forEach(entity => {
        if (!entity) return;
        if (entity.trail.length > 1) {
            ctx.beginPath();
            ctx.strokeStyle = entity.color;
            ctx.lineWidth = 4;
            ctx.shadowBlur = 15;
            ctx.shadowColor = entity.color;
            ctx.moveTo(entity.trail[0].x, entity.trail[0].y);
            for (const p of entity.trail) ctx.lineTo(p.x, p.y);
            ctx.lineTo(entity.x, entity.y);
            ctx.stroke();
            ctx.shadowBlur = 0;
        }
        ctx.save();
        ctx.translate(entity.x, entity.y);
        ctx.rotate(entity.angle);
        ctx.fillStyle = "#fff";
        ctx.fillRect(-5, -2.5, 10, 5);
        ctx.restore();
    });

    if (player && !player.crashed) {
        const length = 50;
        const ex = player.x + Math.cos(input.mouseAngle) * length;
        const ey = player.y + Math.sin(input.mouseAngle) * length;
        const grad = ctx.createLinearGradient(player.x, player.y, ex, ey);
        grad.addColorStop(0, "rgba(255, 0, 60, 0)");
        grad.addColorStop(1, "rgba(255, 0, 60, 1)");
        ctx.beginPath();
        ctx.strokeStyle = grad;
        ctx.lineWidth = 4;
        ctx.moveTo(player.x, player.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
    }
    ctx.restore();

    // 4. UI / HUD
    drawMinimap(entities);
    drawBotCount();

    if (player) {
        drawStreetName();
        if (player.crashed) {
            ctx.fillStyle = "rgba(0,0,0,0.7)";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = "#ff003c";
            ctx.font = "bold 48px Courier New";
            ctx.textAlign = "center";
            ctx.fillText("CRASHED", canvas.width/2, canvas.height/2);
            ctx.font = "24px Courier New";
            ctx.fillStyle = "#fff";
            ctx.fillText(player.crashReason, canvas.width/2, canvas.height/2 + 40);
        } else {
            smoothSpeedKmh = Utils.lerp(smoothSpeedKmh, player.speed * 60 * 3.6, 0.1);
            ctx.font = "bold 24px Courier New";
            ctx.fillStyle = "#00f3ff";
            ctx.textAlign = "right";
            ctx.fillText(`${Math.floor(smoothSpeedKmh)} KM/H`, canvas.width - 20, canvas.height - 20);
        }
    }
}

function drawMinimap(entities) {
    if (!player) return;

    const isSmallScreen = canvas.width < 600;
    const mapSize = isSmallScreen ? 150 : 250;
    const margin = 20;
    const centerX = margin + mapSize / 2;
    const centerY = canvas.height - margin - mapSize / 2;
    const radius = mapSize / 2;

    // Minimap view range in world units
    const viewRadius = 1500; 
    const scale = radius / viewRadius;

    ctx.save();
    
    // Create circular clip area
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.clip();

    ctx.translate(centerX, centerY);
    ctx.scale(scale, scale);
    ctx.translate(-player.x, -player.y);

    entities.forEach(e => {
        if (!e) return;
        ctx.beginPath();
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 40; 
        if (e.trail.length > 0) {
            ctx.moveTo(e.trail[0].x, e.trail[0].y);
            for (const p of e.trail) ctx.lineTo(p.x, p.y);
        }
        ctx.lineTo(e.x, e.y);
        ctx.stroke();

        if (e === player) {
            ctx.fillStyle = "#fff";
            ctx.beginPath();
            ctx.arc(e.x, e.y, 60, 0, Math.PI * 2); 
            ctx.fill();
        }
    });

    ctx.restore();
}

function drawStreetName() {
    const road = network.getClosestRoad({ x: player.x, y: player.y });
    if (road && road.properties) {
        const name = road.properties.name || road.properties.ref;
        if (name) {
            ctx.font = "bold 22px Courier New";
            ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
            ctx.textAlign = "left";
            ctx.fillText(name, 20, 40);
        }
    }
}

function drawBotCount() {
    ctx.font = "bold 24px Courier New";
    ctx.fillStyle = "#ff003c";
    ctx.textAlign = "right";
    ctx.fillText("BOTS: " + bots.length, canvas.width - 20, 40);
}