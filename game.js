/**
 * MAIN GAME CONTROLLER
 */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const FONT = "'Orbitron', 'Courier New', monospace";
// Screen size in CSS pixels; the canvas backing store is scaled by devicePixelRatio
// (capped at 2 for performance) so lines stay sharp on HiDPI/phone screens.
let screenW = 0, screenH = 0, dpr = 1;

function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    screenW = window.innerWidth;
    screenH = window.innerHeight;
    canvas.width = Math.round(screenW * dpr);
    canvas.height = Math.round(screenH * dpr);
    canvas.style.width = screenW + 'px';
    canvas.style.height = screenH + 'px';
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

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
let playerWon = false;
let roundOver = false;  // Set once per round when the player crashes or wins
let roundTime = 0;      // Seconds survived this round (game time, not wall clock)
let roundKills = 0;     // Bots eliminated this round (excluding the one that killed the player)
let shake = 0;          // Screen shake strength in pixels, decays each frame
let bestScore = null;   // Best { kills, time } for the current map

let currentMapUrl = 'maps/pula.json';
let currentBotCount = 0;

const menu = document.getElementById('menu');
const startBtn = document.getElementById('startBtn');
const mapInput = document.getElementById('mapInput');
const botInput = document.getElementById('botInput');
const menuBtn = document.getElementById('menuBtn');

startBtn.addEventListener('click', () => {
    // Fullscreen hides the browser bars on phones. Only on touch devices: on desktop,
    // Escape would exit fullscreen instead of opening the menu.
    if (window.matchMedia('(pointer: coarse)').matches && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
    }
    const map = mapInput.value;
    const count = parseInt(botInput.value) || 0;
    menu.style.display = 'none';
    initGame(map, count);
});

function showMenu() {
    stopGame();
    menuBtn.style.display = 'none';
    menu.style.display = 'flex';
}

menuBtn.addEventListener('click', showMenu);

window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && isGameRunning) showMenu();
});

function spawnCars() {
    player = new Car(network, false);
    const playerPos = { x: player.x, y: player.y };
    bots = [];
    for (let i = 0; i < currentBotCount; i++) {
        bots.push(new Car(network, true, playerPos));
    }
    smoothSpeedKmh = 0;
    playerWon = false;
    roundOver = false;
    roundTime = 0;
    roundKills = 0;
    shake = 0;
}

// Best scores are stored per map; storage can be unavailable (private mode etc.)
function loadBestScore(mapUrl) {
    try {
        return JSON.parse(localStorage.getItem('neondrive.best.' + mapUrl)) || { kills: 0, time: 0 };
    } catch {
        return { kills: 0, time: 0 };
    }
}

function saveBestScore(mapUrl, score) {
    try {
        localStorage.setItem('neondrive.best.' + mapUrl, JSON.stringify(score));
    } catch {}
}

function endRound() {
    roundOver = true;
    bestScore = {
        kills: Math.max(bestScore.kills, roundKills),
        time: Math.max(bestScore.time, roundTime),
    };
    saveBestScore(currentMapUrl, bestScore);

    if (player.crashed) {
        shake = 15;
        if (navigator.vibrate) navigator.vibrate(200);
    }
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

const handleRestart = (e) => {
    if (!isGameRunning) return;
    if (e.type === 'mousedown' && e.button !== 0) return;

    if (player && (player.crashed || playerWon)) spawnCars();
};

canvas.addEventListener('mousedown', handleRestart);
canvas.addEventListener('touchstart', handleRestart);

async function initGame(mapUrl, botCount) {
    stopGame();
    await sound.init();

    currentMapUrl = mapUrl;
    currentBotCount = botCount;
    smoothSpeedKmh = 0;
    bestScore = loadBestScore(mapUrl);
    
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

    spawnCars();

    isGameRunning = true;
    menuBtn.style.display = 'block';
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
    // 1ms tolerance: on 60Hz screens frames arrive every ~16.6ms with jitter,
    // and a strict check would skip some of them, halving the frame rate.
    if (deltaTime < FRAME_MIN_TIME - 1) return;

    lastTime = currentTime - (deltaTime % FRAME_MIN_TIME);
    
    const playerPos = player ? { x: player.x, y: player.y } : null;

    // 1. Update Phase
    if (player && !playerWon) {
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

    if (player && !player.crashed) roundKills += bots.filter(bot => bot.crashed).length;
    bots = bots.filter(bot => !bot.crashed);

    // Win when every bot has been eliminated (no win condition in free-drive with 0 bots)
    if (player && !player.crashed && currentBotCount > 0 && bots.length === 0 && !playerWon) {
        playerWon = true;
        player.speed = 0; // Stop the car (and its engine sound)
    }

    if (player && !roundOver) {
        if (player.crashed || playerWon) endRound();
        else roundTime += FRAME_MIN_TIME / 1000;
    }
    shake *= 0.9;

    if (player) sound.update(player, bots);

    // 2. Camera Logic
    const targetZoom = player ? screenW*0.002 / (1 + (player.speed * 0.3)) : 1;
    cameraZoom = Utils.lerp(cameraZoom, targetZoom, 0.05);

    // 3. Render Phase
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0d0221";
    ctx.fillRect(0, 0, screenW, screenH);

    ctx.save();
    let camX = 0, camY = 0;
    if (player) {
        camX = player.x;
        camY = player.y;
        const shakeX = (Math.random() - 0.5) * 2 * shake;
        const shakeY = (Math.random() - 0.5) * 2 * shake;
        ctx.translate(screenW / 2 + shakeX, screenH / 2 + shakeY);
        ctx.scale(cameraZoom, cameraZoom);
        ctx.translate(-player.x, -player.y);
    }

    // DRAW MAP BOUNDARIES
    if (mapBounds) {
        ctx.strokeStyle = "#b026ff";
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
    ctx.lineWidth = Math.max(2, 2.5 / cameraZoom); // At least ~2.5px on screen
    ctx.strokeStyle = "#3d2f7a";
    ctx.lineCap = "round";
    const viewW = screenW / cameraZoom;
    const viewH = screenH / cameraZoom;
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
            ctx.moveTo(entity.trail[0].x, entity.trail[0].y);
            for (const p of entity.trail) ctx.lineTo(p.x, p.y);
            ctx.lineTo(entity.x, entity.y);
            // Fake glow: wide faint stroke under a thin bright one (much cheaper than shadowBlur)
            ctx.globalAlpha = 0.25;
            ctx.lineWidth = 12;
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.lineWidth = 4;
            ctx.stroke();
        }
        ctx.save();
        ctx.translate(entity.x, entity.y);
        ctx.rotate(entity.angle);
        // Colored halo so cars stand out on small screens
        ctx.fillStyle = entity.color;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(-9, -5.5, 18, 11);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#fff";
        ctx.fillRect(-5, -2.5, 10, 5);
        ctx.restore();
    });

    if (player && !player.crashed) {
        const length = 100;
        const ex = player.x + Math.cos(input.mouseAngle) * length / cameraZoom;
        const ey = player.y + Math.sin(input.mouseAngle) * length / cameraZoom;
        const grad = ctx.createLinearGradient(player.x, player.y, ex, ey);
        grad.addColorStop(0, "rgba(255, 215, 0, 0)");
        grad.addColorStop(1, "rgba(255, 215, 0, 0.6)");
        ctx.beginPath();
        ctx.strokeStyle = grad;
        ctx.lineWidth = 10 / cameraZoom;
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
            ctx.fillRect(0, 0, screenW, screenH);
            ctx.fillStyle = "#ff003c";
            ctx.font = `bold 48px ${FONT}`;
            ctx.textAlign = "center";
            ctx.fillText("CRASHED", screenW/2, screenH/2);
            ctx.font = `24px ${FONT}`;
            ctx.fillStyle = "#fff";
            ctx.fillText(player.crashReason, screenW/2, screenH/2 + 40);
            drawRoundSummary();
        } else if (playerWon) {
            ctx.fillStyle = "rgba(0,0,0,0.7)";
            ctx.fillRect(0, 0, screenW, screenH);
            ctx.fillStyle = "#00f3ff";
            ctx.font = `bold 48px ${FONT}`;
            ctx.textAlign = "center";
            ctx.fillText("YOU WIN", screenW/2, screenH/2);
            ctx.font = `24px ${FONT}`;
            ctx.fillStyle = "#fff";
            ctx.fillText("ALL BOTS ELIMINATED", screenW/2, screenH/2 + 40);
            drawRoundSummary();
        } else {
            smoothSpeedKmh = Utils.lerp(smoothSpeedKmh, player.speed * 60 * 3.6, 0.1);
            ctx.font = `bold 24px ${FONT}`;
            ctx.fillStyle = "#00f3ff";
            ctx.textAlign = "right";
            ctx.fillText(`${Math.floor(smoothSpeedKmh)} KM/H`, screenW - 20, screenH - 20);
        }
    }
}

function drawRoundSummary() {
    ctx.textAlign = "center";
    ctx.font = `bold 18px ${FONT}`;
    ctx.fillStyle = "#00f3ff";
    ctx.fillText(`TIME ${formatTime(roundTime)}  ·  BOTS ${roundKills}`, screenW/2, screenH/2 + 85);
    ctx.font = `16px ${FONT}`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.fillText(`BEST ${formatTime(bestScore.time)}  ·  BOTS ${bestScore.kills}`, screenW/2, screenH/2 + 112);
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.fillText("TAP / CLICK TO RESTART", screenW/2, screenH/2 + 155);
}

function drawMinimap(entities) {
    if (!player) return;

    const isSmallScreen = screenW < 600;
    const mapSize = isSmallScreen ? 150 : 250;
    const margin = 20;
    const centerX = margin + mapSize / 2;
    const centerY = screenH - margin - mapSize / 2;
    const radius = mapSize / 2;

    // Minimap view range in world units
    const viewRadius = 1500; 
    const scale = radius / viewRadius;

    ctx.save();
    
    // Create circular clip area
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
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
            ctx.font = `bold 20px ${FONT}`;
            ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
            ctx.textAlign = "left";
            ctx.fillText(name, 20, 40);
        }
    }
}

function drawBotCount() {
    ctx.font = `bold 24px ${FONT}`;
    ctx.fillStyle = "#ff003c";
    ctx.textAlign = "right";
    ctx.fillText("BOTS: " + bots.length, screenW - 20, 40);
}