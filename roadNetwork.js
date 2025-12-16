/**
 * ROAD NETWORK
 * Parsing and Graph generation from GeoJSON
 * Implements Spatial Partitioning (Grid) for performance optimization
 */
class RoadNetwork {
    constructor() {
        this.nodes = []; // Array of {id, x, y, outgoing: []}
        this.roads = []; // Master list of all segments
        
        // Spatial Partitioning
        this.grid = new Map(); // Key: "col,row", Value: [Roads]
        this.CELL_SIZE = 2000; // Size of each grid cell in world units
    }

    async load(url) {
        const response = await fetch(url);
        const json = await response.json();
        this.parse(json);
    }

    parse(json) {
        // RESET DATA
        this.nodes = [];
        this.roads = [];
        this.grid = new Map();

        // 1. Project Coordinates & Count Occurrences
        const pointCounts = new Map(); 
        const project = this.createProjection(json);
        const getKey = (p) => `${Math.round(p.x)},${Math.round(p.y)}`;

        // Pass 1: Count intersections
        json.features.forEach(f => {
            f.geometry.coordinates.forEach(c => {
                const p = project(c[0], c[1]);
                const key = getKey(p);
                pointCounts.set(key, (pointCounts.get(key) || 0) + 1);
            });
        });

        // Pass 2: Split Ways into Segments at intersections
        json.features.forEach(f => {
            const coords = f.geometry.coordinates;
            let currentSegmentPoints = [];
            
            for (let i = 0; i < coords.length; i++) {
                const p = project(coords[i][0], coords[i][1]);
                currentSegmentPoints.push(p);

                const key = getKey(p);
                const isIntersection = pointCounts.get(key) > 1;
                const isLastPoint = i === coords.length - 1;

                if ((isIntersection || isLastPoint) && currentSegmentPoints.length > 1) {
                    // Create Forward Segment
                    this.createRoadSegment(currentSegmentPoints, getKey);
                    
                    // Create Reverse Segment
                    const reversePoints = [...currentSegmentPoints].reverse();
                    this.createRoadSegment(reversePoints, getKey);
                    
                    // Link Reverse IDs
                    const roadA = this.roads[this.roads.length - 2];
                    const roadB = this.roads[this.roads.length - 1];
                    roadA.reverseId = roadB.id;
                    roadB.reverseId = roadA.id;

                    currentSegmentPoints = [p]; 
                }
            }
        });
        console.log(`Graph Built: ${this.nodes.length} Nodes, ${this.roads.length} Segments.`);
    }

    createProjection(json) {
        const bounds = { minLon: Infinity, maxLon: -Infinity, minLat: Infinity, maxLat: -Infinity };
        json.features.forEach(f => {
            f.geometry.coordinates.forEach(c => {
                if (c[0] < bounds.minLon) bounds.minLon = c[0];
                if (c[0] > bounds.maxLon) bounds.maxLon = c[0];
                if (c[1] < bounds.minLat) bounds.minLat = c[1];
                if (c[1] > bounds.maxLat) bounds.maxLat = c[1];
            });
        });
        const centerLon = (bounds.minLon + bounds.maxLon) / 2;
        const centerLat = (bounds.minLat + bounds.maxLat) / 2;
        const scale = 111139; 
        return (lon, lat) => ({
            x: (lon - centerLon) * scale * Math.cos(centerLat * Math.PI / 180),
            y: -(lat - centerLat) * scale 
        });
    }

    createRoadSegment(points, keyFn) {
        const startKey = keyFn(points[0]);
        const endKey = keyFn(points[points.length - 1]);
        const startNode = this.getOrCreateNode(startKey, points[0]);
        const endNode = this.getOrCreateNode(endKey, points[points.length - 1]);

        // Snap points to nodes
        points[0] = { x: startNode.x, y: startNode.y };
        points[points.length - 1] = { x: endNode.x, y: endNode.y };

        const road = {
            id: this.roads.length,
            points: points,
            startNodeIdx: this.nodes.indexOf(startNode),
            endNodeIdx: this.nodes.indexOf(endNode),
            startAngle: this.calculateRoadAngle(points),
            reverseId: -1
        };
        
        this.roads.push(road);
        startNode.outgoing.push(road);

        // Add to Spatial Grid
        this.addToGrid(road);

        return road;
    }

    addToGrid(road) {
        // Calculate bounding box of the road segment
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of road.points) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }

        // Determine which grid cells this rect overlaps
        const startCol = Math.floor(minX / this.CELL_SIZE);
        const endCol = Math.floor(maxX / this.CELL_SIZE);
        const startRow = Math.floor(minY / this.CELL_SIZE);
        const endRow = Math.floor(maxY / this.CELL_SIZE);

        for (let c = startCol; c <= endCol; c++) {
            for (let r = startRow; r <= endRow; r++) {
                const key = `${c},${r}`;
                if (!this.grid.has(key)) {
                    this.grid.set(key, []);
                }
                this.grid.get(key).push(road);
            }
        }
    }

    // Efficiently get only roads within the camera view
    getRoadsInRect(minX, minY, maxX, maxY) {
        const visibleRoads = new Set();
        
        const startCol = Math.floor(minX / this.CELL_SIZE);
        const endCol = Math.floor(maxX / this.CELL_SIZE);
        const startRow = Math.floor(minY / this.CELL_SIZE);
        const endRow = Math.floor(maxY / this.CELL_SIZE);

        for (let c = startCol; c <= endCol; c++) {
            for (let r = startRow; r <= endRow; r++) {
                const key = `${c},${r}`;
                const cell = this.grid.get(key);
                if (cell) {
                    for (const road of cell) {
                        visibleRoads.add(road);
                    }
                }
            }
        }
        return visibleRoads;
    }

    getOrCreateNode(key, point) {
        let node = this.nodes.find(n => n.id === key);
        if (!node) {
            node = { id: key, x: point.x, y: point.y, outgoing: [] };
            this.nodes.push(node);
        }
        return node;
    }

    calculateRoadAngle(points) {
        let lookAheadIndex = 1;
        while (lookAheadIndex < points.length - 1 && Utils.dist(points[0], points[lookAheadIndex]) < 10) {
            lookAheadIndex++;
        }
        return Utils.angleTo(points[0], points[lookAheadIndex]);
    }
}