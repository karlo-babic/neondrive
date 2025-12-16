/**
 * MAIN GAME CONTROLLER
 */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// Resize listener
window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});

const network = new RoadNetwork();
const input = new InputHandler();

// Game State
let player = null;
let bots = [];
let cameraZoom = 1;
let isGameRunning = false;
let animationFrameId = null; 

// Performance / FPS Capping
let lastTime = 0;
const FPS_LIMIT = 60;
const FRAME_MIN_TIME = 1000 / FPS_LIMIT; // ~16.67ms
let accumulatedTime = 0;

// HUD Smoothing
let smoothSpeedKmh = 0;

// Session Settings
let currentMapUrl = 'maps/pula.json';
let currentBotCount = 10;

// UI Elements
const menu = document.getElementById('menu');
const startBtn = document.getElementById('startBtn');
const mapInput = document.getElementById('mapInput');
const botInput = document.getElementById('botInput');

// --- MENU HANDLERS ---

// Clear map input on click/focus for easier typing
// Wrapped in setTimeout to prevent conflicting with mobile browser focus/keyboard logic
mapInput.addEventListener('focus', () => {
    setTimeout(() => {
        mapInput.value = '';
    }, 10);
});

startBtn.addEventListener('click', () => {
    const map = mapInput.value.trim() || 'maps/pula.json';
    const count = parseInt(botInput.value) || 0;
    
    menu.style.display = 'none';
    initGame(map, count);
});

// Escape key to return to Main Menu
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
        bots = [];
        for(let i=0; i<currentBotCount; i++) bots.push(new Car(network, true));
        smoothSpeedKmh = 0;
    }
};

canvas.addEventListener('mousedown', handleRestart);
canvas.addEventListener('touchstart', handleRestart);

// --- GAME LOGIC ---

async function initGame(mapUrl, botCount) {
    stopGame();

    currentMapUrl = mapUrl;
    currentBotCount = botCount;
    smoothSpeedKmh = 0;
    
    try {
        await network.load(currentMapUrl);
    } catch (err) {
        console.error(err);
        alert("Failed to load map: " + currentMapUrl + "\nCheck if file exists in 'maps/' folder.");
        menu.style.display = 'flex';
        return;
    }

    player = new Car(network, false);
    bots = [];
    for(let i=0; i<currentBotCount; i++) {
        bots.push(new Car(network, true));
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

    if (deltaTime < FRAME_MIN_TIME) {
        return;
    }

    lastTime = currentTime - (deltaTime % FRAME_MIN_TIME);
    const dtSeconds = Math.min(deltaTime / 1000, 0.1); 

    // 1. Update Phase
    if (player) {
        player.update(input);
        bots.forEach(bot => player.checkCollision(bot));
    }

    bots.forEach(bot => {
        bot.update(null); 
        if (player && !player.crashed) bot.checkCollision(player);
        bots.forEach(otherBot => {
            if (bot !== otherBot) bot.checkCollision(otherBot);
        });
    });

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

    // DRAW MAP (OPTIMIZED)
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#1a1a40"; 
    ctx.lineCap = "round";
    
    const viewW = canvas.width / cameraZoom;
    const viewH = canvas.height / cameraZoom;
    const margin = 500; 

    const visibleRoads = network.getRoadsInRect(
        camX - viewW / 2 - margin,
        camY - viewH / 2 - margin,
        camX + viewW / 2 + margin,
        camY + viewH / 2 + margin
    );

    ctx.beginPath();
    for (const road of visibleRoads) {
        ctx.moveTo(road.points[0].x, road.points[0].y);
        for (let i = 1; i < road.points.length; i++) {
            ctx.lineTo(road.points[i].x, road.points[i].y);
        }
    }
    ctx.stroke();

    const entities = [...bots, player];

    // Draw Entities
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

        ctx.beginPath();
        ctx.fillStyle = "#ff003c";
        ctx.shadowBlur = 10;
        ctx.shadowColor = "#ff003c";
        ctx.arc(ex, ey, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0; 
    }

    ctx.restore();

    // 4. UI / HUD
    drawMinimap(entities);

    if (player) {
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
            ctx.font = "16px Courier New";
            ctx.fillText("TAP OR CLICK TO RESTART", canvas.width/2, canvas.height/2 + 80);
        } else {
            const fps = 60;
            const currentRealSpeed = player.speed * fps * 3.6; 
            smoothSpeedKmh = Utils.lerp(smoothSpeedKmh, currentRealSpeed, 0.1);

            ctx.font = "bold 32px Courier New";
            ctx.fillStyle = "#00f3ff";
            ctx.textAlign = "right";
            ctx.fillText(`${Math.floor(smoothSpeedKmh)} KM/H`, canvas.width - 20, canvas.height - 20);
        }
    }
}

function drawMinimap(entities) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let hasPoints = false;

    entities.forEach(e => {
        if(!e) return;
        e.trail.forEach(p => {
            if(p.x < minX) minX = p.x;
            if(p.x > maxX) maxX = p.x;
            if(p.y < minY) minY = p.y;
            if(p.y > maxY) maxY = p.y;
            hasPoints = true;
        });
        if(e.x < minX) minX = e.x;
        if(e.x > maxX) maxX = e.x;
        if(e.y < minY) minY = e.y;
        if(e.y > maxY) maxY = e.y;
        hasPoints = true;
    });

    if (!hasPoints) return;

    const isSmallScreen = canvas.width < 600;
    const mapSize = isSmallScreen ? 150 : 250;
    const margin = 20;
    const mapX = margin;
    const mapY = canvas.height - mapSize - margin;

    const padding = 100; 
    const worldWidth = Math.max(100, maxX - minX + padding);
    const worldHeight = Math.max(100, maxY - minY + padding);
    const worldCenterX = (minX + maxX) / 2;
    const worldCenterY = (minY + maxY) / 2;

    const scale = Math.min(mapSize / worldWidth, mapSize / worldHeight);

    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.fillRect(mapX, mapY, mapSize, mapSize);
    ctx.strokeRect(mapX, mapY, mapSize, mapSize);

    ctx.beginPath();
    ctx.rect(mapX, mapY, mapSize, mapSize);
    ctx.clip();

    ctx.translate(mapX + mapSize / 2, mapY + mapSize / 2);
    ctx.scale(scale, scale);
    ctx.translate(-worldCenterX, -worldCenterY);

    entities.forEach(e => {
        if(!e) return;
        
        ctx.beginPath();
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 60;
        
        if (e.trail.length > 0) {
            ctx.moveTo(e.trail[0].x, e.trail[0].y);
            for(const p of e.trail) ctx.lineTo(p.x, p.y);
        }
        ctx.lineTo(e.x, e.y);
        ctx.stroke();

        if (e === player) {
            ctx.fillStyle = "#fff";
            ctx.beginPath();
            ctx.arc(e.x, e.y, 80, 0, Math.PI * 2); 
            ctx.fill();

            ctx.strokeStyle = "#00f3ff";
            ctx.lineWidth = 100;
            ctx.beginPath();
            ctx.arc(e.x, e.y, 150, 0, Math.PI * 2);
            ctx.stroke();
        }
    });

    ctx.restore();
}