/**
 * INPUT HANDLER
 * Manages Mouse/Touch position and Buttons for acceleration/braking
 */
class InputHandler {
    constructor() {
        this.mouseAngle = 0; 
        this.accelerating = false;
        this.braking = false;
        
        // Reference to canvas to distinguish between game touches and UI touches
        const canvas = document.getElementById('gameCanvas');

        // --- MOUSE CONTROLS ---
        document.addEventListener('mousemove', e => {
            this.updateAngle(e.clientX, e.clientY);
        });

        document.addEventListener('mousedown', e => {
            if (e.button === 0) this.accelerating = true; // Left Click
            if (e.button === 2) this.braking = true;      // Right Click
        });

        document.addEventListener('mouseup', e => {
            if (e.button === 0) this.accelerating = false;
            if (e.button === 2) this.braking = false;
        });

        document.addEventListener('contextmenu', e => e.preventDefault());

        // Keyboard
        document.addEventListener('keydown', e => {
            if (e.code === 'KeyW' || e.code === 'ArrowUp') this.accelerating = true;
            if (e.code === 'KeyS' || e.code === 'ArrowDown') this.braking = true;
        });
        document.addEventListener('keyup', e => {
            if (e.code === 'KeyW' || e.code === 'ArrowUp') this.accelerating = false;
            if (e.code === 'KeyS' || e.code === 'ArrowDown') this.braking = false;
        });

        // --- TOUCH CONTROLS (Mobile) ---
        const handleTouch = (e) => {
            // Allow interaction with Menu UI (Inputs/Buttons)
            // If the user touches the Menu or HTML inputs, ignore game logic 
            // and do NOT prevent default behavior.
            if (e.target !== canvas) return;

            // Prevent default browser scrolling/zooming ONLY when touching canvas
            if(e.cancelable) e.preventDefault();
            
            if (e.touches.length > 0) {
                // Steer towards the first finger
                const t = e.touches[0];
                this.updateAngle(t.clientX, t.clientY);
                
                // Logic: 1 Finger = Gas, 2+ Fingers = Brake
                if (e.touches.length === 1) {
                    this.accelerating = true;
                    this.braking = false;
                } else {
                    this.accelerating = false;
                    this.braking = true;
                }
            } else {
                // No fingers touching
                this.accelerating = false;
                this.braking = false;
            }
        };

        // Passive: false is required to use preventDefault()
        document.addEventListener('touchstart', handleTouch, { passive: false });
        document.addEventListener('touchmove', handleTouch, { passive: false });
        document.addEventListener('touchend', handleTouch);
        document.addEventListener('touchcancel', handleTouch);
    }

    updateAngle(x, y) {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        this.mouseAngle = Math.atan2(y - cy, x - cx);
    }
}