/**
 * GEOMETRY AND MATH UTILITIES
 */
const Utils = {
    // Euclidean distance
    dist: (p1, p2) => Math.hypot(p2.x - p1.x, p2.y - p1.y),

    // Linear Interpolation
    lerp: (start, end, t) => start * (1 - t) + end * t,

    // Angle from point A to B
    angleTo: (p1, p2) => Math.atan2(p2.y - p1.y, p2.x - p1.x),

    // Smallest difference between two angles (-PI to PI)
    angleDiff: (a1, a2) => {
        let diff = a2 - a1;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        return diff;
    }
};