import {rgba, idx} from './utils';

// Define Enums
export const VertexTypes = {
  VERTEX: 'vertex', MIDPOINT: 'midpoint',
  CONTROL_POINT: 'control_point',
};
export const EdgeTypes = {LINE: 'line', BEZIER: 'bezier'};

// find bbox around a set of vertices
const getBbox = function(vertices) {
  let minX = Number.MAX_SAFE_INTEGER;
  let minY = Number.MAX_SAFE_INTEGER;
  let maxX = 0;
  let maxY = 0;
  for (let v of vertices) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
  }
  return {min: {x: minX, y: minY}, max: {x: maxX, y: maxY}};
};

/**
 * Shape class
 * base class for all shapes, holds index
 * that will be dynamically assigned by SatItem
 * to determine the color code on hidden canvas
 * @param {number} id - id of the shape. Needed only when loading saved shapes.
 */
export function Shape(id = null) {
  Shape.registerShape(this, id);
}

Shape.allShapes = {};
Shape.largestId = -1;
Shape.collisionList = [];

Shape.registerShape = function(shape, id = null) {
  if (id === null) {
    shape.id = Shape.newId();
  } else {
    if (Shape.hasId(id)) {
      // for collision, append to collision list
      Shape.collisionList.push(shape);
      return;
    } else {
      shape.id = id;
    }
  }
  Shape.updateLargestId(shape.id);
  // id < 0 for temporary shapes that don't need an id
  if (shape.id > 0) {
    Shape.allShapes[shape.id] = shape;
  }
};

Shape.newId = function() {
  return Shape.largestId + 1;
};

Shape.updateLargestId = function(id) {
  if (id > Shape.largestId) {
    Shape.largestId = id;
  }
};

Shape.resolveIdCollision = function() {
  for (let shape of Shape.collisionList) {
    shape.id = Shape.newId();
    Shape.allShapes[shape.id] = shape;
    Shape.updateLargestId();
  }
  Shape.collisionList = [];
};

Shape.getShapeById = function(id) {
  return Shape.allShapes[id];
};

Shape.hasId = function(id) {
  return id in Shape.allShapes;
};

Shape.prototype.delete = function() {
  delete Shape.allShapes[this.id];
};

/**
 * Vertex Class is designed to be non-traversable by itself,
 * because no vertex will be selected without a known
 * polygon that contains the vertex, so polygon object is responsible
 * for all the traversal needs. This design keeps a clean cut in
 * object responsibilities and avoids heterogeneous circular
 * references.
 * P.S. everything is in image coordinate
 * index should always be preserved
 * @param {int} x: x-coordinate
 * @param {int} y: y-coordinate
 * @param {object} type: type of the vertex
 * @param {number} id - id of the shape. Needed only when loading saved shapes.
 */
export function Vertex(x = 0, y = 0, type = VertexTypes.VERTEX, id = null) {
  Shape.call(this, id);
  this._x = x;
  this._y = y;
  this.type = type;
}

Object.assign(Vertex, Shape);
Vertex.prototype = Object.create(Shape.prototype);
Vertex.prototype.constructor = Vertex;

Object.defineProperty(Vertex.prototype, 'x', {
  get: function() {
    return this._x;
  },
  set: function(x) {
    this._x = x;
  },
});

Object.defineProperty(Vertex.prototype, 'y', {
  get: function() {
    return this._y;
  },
  set: function(y) {
    this._y = y;
  },
});

Object.defineProperty(Vertex.prototype, 'xy', {
  get: function() {
    return [this._x, this._y];
  },
  set: function(xy) {
    let [x, y] = xy;
    this.x = x;
    this.y = y;
  },
});

Object.defineProperty(Vertex.prototype, 'x_int', {
  get: function() {
    return Math.round(this.x);
  },
});

Object.defineProperty(Vertex.prototype, 'y_int', {
  get: function() {
    return Math.round(this.y);
  },
});

/**
 * Interpolation towards a target point
 * @param {object} v: target vertex
 * @param {number} f: fraction to interpolate towards v
 * @param {string} type: the type of the vertex
 * @param {int} id: the temporary id to assign
 * @return {object} interpolated point
 */
Vertex.prototype.interpolate = function(v, f, type, id = null) {
  let [x, y] = this.interpolateCoords(v, f);
  return new Vertex(x, y, type, id);
};

/**
 * Interpolation towards a target point
 * @param {object} v: target vertex
 * @param {number} f: fraction to interpolate towards v
 * @return {[number]} coordinates of the interpolated point
 */
Vertex.prototype.interpolateCoords = function(v, f) {
  return [this.x + (v.x - this.x) * f, this.y + (v.y - this.y) * f];
};

/**
 * Calculate distance from the current vertex to target point
 * @param {object} v: target vertex
 * @return {int} distance
 */
Vertex.prototype.distanceTo = function(v) {
  let a = this.x - v.x;
  let b = this.y - v.y;
  return Math.sqrt(a * a + b * b);
};

Vertex.prototype.toJson = function() {
  return {
    id: this.id,
    type: this.type,
    x: this.x,
    y: this.y,
  };
};

Vertex.fromJson = function(json) {
  if (Shape.hasId(json.id)) {
    let shapeWithSameId = Shape.getShapeById(json.id);
    if (shapeWithSameId instanceof Vertex &&
        shapeWithSameId.type === json.type &&
        shapeWithSameId._x === json.x &&
        shapeWithSameId._y === json.y
    ) {
      // if same as an existing vertex, return the existing one
      return Shape.getShapeById(json.id);
    }
  }
  // else, create a new one or let Shape handle collision
  return new Vertex(json.x, json.y, json.type, json.id);
};

// Deep Copy with newly assigned ID
Vertex.prototype.copy = function(temporary=null) {
  return new Vertex(this.x, this.y, this.type, temporary);
};

Vertex.prototype.equals = function(v, threshold = 1e-6) {
  if (!v) return false;
  return Math.abs(this.x - v.x) < threshold
      && Math.abs(this.y - v.y) < threshold;
};

/**
 * Edge Class, take in objects as input to keep references clean
 * Principle: redundant information is not stored as attributes
 * but written as getters instead to keep serialization clean.
 * Note: setting vertex reference does not re-initializes control
 * points automatically (make not want to destroy previously drawn
 * bezier curve). To drag a bezier control point (pt) to
 * position [x, y], simply call pt.xy = [x, y]
 * @param {object} src: source vertex
 * @param {object} dest: destination vertex
 * @param {string} type: connection type, line or bezier
 * @param {number} id - id of the shape. Needed only when loading saved shapes.
 * @param {[Vertex]} controlPoints - control points of the Edge object.
 * Needed only when loading saved shapes.
 */
export function Edge(src, dest, type = EdgeTypes.LINE,
                     id = null, controlPoints = []) {
  Shape.call(this, id);
  this._src = src; // define private variables to avoid recursive setter
  this._dest = dest;
  this._type = type;
  this._control_points = [];
  if (controlPoints.length > 0) {
    this._control_points = controlPoints;
  } else {
    this.initControlPoints();
  }
  this.subShapeId = id === -1 ? -1 : null;
}

Object.assign(Edge, Shape);
Edge.prototype = Object.create(Shape.prototype);
Edge.prototype.constructor = Edge;

// define getter and setters
// setters eagerly maintains size, bbox and control points
// eager setters are efficient in this case because most
// edges in a polygon is not changing at every frame
Object.defineProperty(Edge.prototype, 'src', {
  get: function() {
    return this._src;
  },
  set: function(vertex) {
    this._src = vertex;
  },
});

Object.defineProperty(Edge.prototype, 'dest', {
  get: function() {
    return this._dest;
  },
  set: function(vertex) {
    this._dest = vertex;
  },
});

Object.defineProperty(Edge.prototype, 'type', {
  get: function() {
    return this._type;
  },
  set: function(newType) {
    if (this.type === newType) {
      return;
    } // do nothing
    this._type = newType;
    this.initControlPoints();
  },
});

Object.defineProperty(Edge.prototype, 'control_points', {
  get: function() {
    if (this.type === EdgeTypes.LINE) {
      let [x, y] = this.src.interpolateCoords(this.dest, 1 / 2);
      this._control_points[0].xy = [x, y];
    }
    return this._control_points;
  },
  set: function(points) {
    this._control_points = points;
  },
});

Object.defineProperty(Edge.prototype, 'bbox', {
  get: function() {
    let points = [this.src, this.dest].concat(this.control_points);
    return getBbox(points);
  },
});

Object.defineProperty(Edge.prototype, 'length', {
  get: function() {
    return this.src.distanceTo(this.dest);
  },
});

/**
 * LINE has a size of 2 and BEZIER has a size of 3.
 */
Object.defineProperty(Edge.prototype, 'size', {
  get: function() {
    return 1 + this.control_points.length;
  },
});

/**
 * Compute midpoints of vertices or control points on bezier curve
 * only call when declaring a new edge or change an edge to a new type
 */
Edge.prototype.initControlPoints = function() {
  switch (this.type) {
    case EdgeTypes.LINE: {
      let midpoint = this.src.interpolate(
          this.dest, 1 / 2, VertexTypes.MIDPOINT, -1);
      this._control_points = [midpoint];
      break;
    }
    case EdgeTypes.BEZIER: {
      let control1 = this.src.interpolate(
          this.dest, 1 / 3, VertexTypes.CONTROL_POINT);
      let control2 = this.src.interpolate(
          this.dest, 2 / 3, VertexTypes.CONTROL_POINT);
      this._control_points = [control1, control2];
      break;
    }
  }
};

Edge.prototype.toBezierWithControlPoints = function(c1, c2) {
  this._type = EdgeTypes.BEZIER;
  this._control_points = [c1, c2];
};

Edge.prototype.toLineWithMidpoint = function(midpoint) {
  this._type = EdgeTypes.LINE;
  this._control_points = [midpoint];
};

Edge.prototype.reverse = function() {
  let temp = this.src;
  this.src = this.dest;
  this.dest = temp;
  this.control_points = this.control_points.reverse();
};

/**
 * Check whether the edge contains a point
 * excluding the src and dest points of the edge
 * @param {object} v
 * @return {boolean}
 */
Edge.prototype.contains = function(v) {
  // be careful if there is divide by 0
  let delta1 = (v.y - this.src.y) / (v.x - this.src.x);
  let delta2 = (this.dest.y - this.src.y) / (this.dest.x - this.src.x);
  let lambda = (v.y - this.src.y) / (this.dest.y - this.src.y);
  return delta1 === delta2 && 0 < lambda && lambda < 1;
};

/**
 * Check whether the edge intersect with the target edge
 * @param {object} e
 * @return {*}
 */
Edge.prototype.intersectWith = function(e) {
  let tolerance = 0.01;
  if (this.equals(e)) {
    return true;
  }
  let det;
  let gamma;
  let lambda;
  det = (this.dest.x - this.src.x) * (e.dest.y - e.src.y)
      - (e.dest.x - e.src.x) * (this.dest.y - this.src.y);

  if (det === 0) { // parallel
    return this.contains(e.src) || this.contains(e.dest) ||
        e.contains(this.src) || e.contains(this.dest);
  } else {
    lambda = ((e.dest.y - e.src.y) * (e.dest.x - this.src.x)
        + (e.src.x - e.dest.x) * (e.dest.y - this.src.y)) / det;
    gamma = ((this.src.y - this.dest.y) * (e.dest.x - this.src.x)
        + (this.dest.x - this.src.x) * (e.dest.y - this.src.y)) / det;
    return (tolerance < lambda && lambda < 1 - tolerance)
        && (tolerance < gamma && gamma < 1 - tolerance);
  }
};

Edge.prototype.toJson = function() {
  let controlPoints = [];
  if (this.type === EdgeTypes.BEZIER) {
    for (let controlPoint of this.control_points) {
      controlPoints.push(controlPoint.toJson());
    }
  }
  return {
    id: this.id,
    src: this.src.id,
    dest: this.dest.id,
    type: this.type,
    control_points: controlPoints,
  };
};

/**
 * Decode edge from json object. Assuming vertices already decoded.
 * @param {object} json - the json object to decode.
 * @return {Edge}
 */
Edge.fromJson = function(json) {
  let src = Shape.getShapeById(json.src);
  let dest = Shape.getShapeById(json.dest);
  let controlPoints = [];
  if (json.type === EdgeTypes.BEZIER) {
    for (let controlPoint of json.control_points) {
      controlPoints.push(Vertex.fromJson(controlPoint));
    }
  }
  return new Edge(src, dest, json.type, json.id, controlPoints);
};

// Reference safe Deep copy by serialization
Edge.prototype.copy = function(temporary=null) {
  let controlPoints = [];
  for (let c of this.control_points) {
    controlPoints.push(c.copy(temporary));
  }
  return new Edge(this.src.copy(temporary), this.dest.copy(temporary),
      this.type, temporary, controlPoints);
};

// Equality criteria for undirected edges
Edge.prototype.equals = function(e) {
  let vertexMatch = this.src.equals(e.src) && this.dest.equals(e.dest);
  let reverseMatch = this.src.equals(e.dest) && this.dest.equals(e.src);
  if (!(vertexMatch || reverseMatch)) {
    return false;
  }
  if (this.type !== e.type) {
    return false;
  }
  if (this.size !== e.size) {
    return false;
  }
  for (let i = 0; i < this.control_points.length; i++) {
    let point1 = this.control_points[i];
    let point2;
    if (reverseMatch) {
      point2 = e.control_points[this.control_points.length - i - 1];
    } else {
      point2 = e.control_points[i];
    }
    if (!point1.equals(point2)) {
      return false;
    }
  }
  return true;
};

/**
 * Polyline Class, a superclass for 2d patterns
 * consisting of consecutive line segments
 * @param {number} id - id of the shape. Needed only when loading saved shapes.
 */
export function Polyline(id = null) {
  Shape.call(this, id);
  this.vertices = [];
  this.edges = [];
  this.closed = false;
  this.ended = false;
  // -1 for temporary sub-shapes
  this.subShapeId = id === -1 ? -1 : null;
}

Object.assign(Polyline, Shape);
Polyline.prototype = Object.create(Shape.prototype);
Polyline.prototype.constructor = Polyline;

Object.defineProperty(Polyline.prototype, 'control_points', {
  get: function() {
    let points = [];
    for (let edge of this.edges) {
      points = points.concat(edge.control_points);
    }
    return points;
  },
});

// note this does not bound control points
Object.defineProperty(Polyline.prototype, 'bbox', {
  get: function() {
    // return getBbox(this.vertices);
    return getBbox(this.control_points.concat(this.vertices));
  },
});

Polyline.prototype.endPath = function() {
  this.ended = true;
};

Polyline.prototype.isEnded = function() {
  return this.ended;
};

// return centroid of the curve
Polyline.prototype.centroidCoords = function() {
  let x = 0;
  let y = 0;
  for (let vertex of this.vertices) {
    x += vertex.x;
    y += vertex.y;
  }
  return [x / this.vertices.length, y / this.vertices.length];
};

// check whether a curve is valid
Polyline.prototype.isValidShape = function() {
  return !this.isSelfIntersect() && this.vertices.length > 1;
};

// return true if any two edges intersect with each other
Polyline.prototype.isSelfIntersect = function() {
  let intersect = false;
  for (let i = 0; i < this.edges.length; i++) {
    for (let j = i + 1; j < this.edges.length; j++) {
      if (this.edges[i].intersectWith(this.edges[j])) {
        intersect = true;
      }
    }
  }
  return intersect;
};

/**
 * Align all edges to one direction.
 */
Polyline.prototype.alignEdges = function() {
  for (let i = 0; i < this.edges.length; i++) {
    if (this.vertices[i] === this.edges[i].dest) {
      this.edges[i].reverse();
    }
  }
};

/**
 * Convert midpoint to a new vertex
 * @param {number} edgeIndex: the index of the edge whose midpoint
 * will be converted to a vertex
 * @return {Vertex} the converted vertex
 */
Polyline.prototype.midpointToVertexWithEdgeIndex = function(edgeIndex) {
  let vertex = this.edges[edgeIndex].control_points[0].copy();
  vertex.type = VertexTypes.VERTEX;
  this.insertVertex(edgeIndex + 1, vertex);
  return vertex;
};

/**
 * Convert midpoint to a vertex between two existing vertices
 * @param {Vertex} vertex: the vertex that the midpoint will be converted to
 * @param {Vertex} v1: the first vertex
 * @param {Vertex} v2: the second vertex
 */
Polyline.prototype.convertMidpointToKnownVertexBetween =
    function(vertex, v1, v2) {
  for (let i = 0; i < this.edges.length; i++) {
    if (this.edges[i].hasVertices(v1, v2)) {
      this.alignEdges();
      this.insertVertex(i + 1, vertex);
      break;
    }
  }
};

/**
 * Convert midpoint to bezier control points
 * @param {number} edgeIndex: the index of the edge whose midpoint
 * will be converted to bezier control points
 * @return {[Vertex]} the bezier control points
 */
Polyline.prototype.midpointToBezierControlWithEdgeIndex = function(edgeIndex) {
  this.edges[edgeIndex].type = EdgeTypes.BEZIER;
  return this.edges[edgeIndex].control_points;
};

/**
 * Convert midpoint to known bezier control points between two existing vertices
 * @param {Vertex} c1: the first bezier control point
 * @param {Vertex} c2: the second bezier control point
 * @param {Vertex} v1: the first vertex
 * @param {Vertex} v2: the second vertex
 */
Polyline.prototype.convertMidpointToKnownBezierControlBetween =
    function(c1, c2, v1, v2) {
      for (let edge of this.edges) {
        if (edge.src === v1 && edge.dest === v2) {
          edge.toBezierWithControlPoints(c1, c2);
          break;
        } else if (edge.src === v2 && edge.dest === v1) {
          edge.toBezierWithControlPoints(c2, c1);
          break;
        }
      }
    };

/**
 * Convert bezier control points to a midpoint
 * @param {number} edgeIndex: the index of the edge whose bezier control points
 * will be converted to a midpoint
 * @return {[Vertex]} the midpoint
 */
Polyline.prototype.bezierControlToMidpointWithEdgeIndex = function(edgeIndex) {
  this.edges[edgeIndex].type = EdgeTypes.LINE;
  return this.edges[edgeIndex].control_points[0];
};

/**
 * Convert bezier control points to known midpoint between two existing vertices
 * @param {Vertex} midpoint: the midpoint
 * @param {Vertex} v1: the first vertex
 * @param {Vertex} v2: the second vertex
 */
Polyline.prototype.convertBezierControlToKnownMidpointBetween =
    function(midpoint, v1, v2) {
      for (let edge of this.edges) {
        if (edge.src === v1 && edge.dest === v2) {
          edge.toLineWithMidpoint(midpoint);
          break;
        } else if (edge.src === v2 && edge.dest === v1) {
          edge.toLineWithMidpoint(midpoint);
          break;
        }
      }
    };

Polyline.prototype.getEdgeIndexWithControlPoint = function(pt) {
  for (let i = 0; i < this.edges.length; i++) {
    if (this.edges[i].control_points.indexOf(pt) >= 0) {
      return i;
    }
  }
};

/**
 * Abstract function that should be implemented by child
 */
Polyline.prototype.insertVertex = function() {
};

/**
 * Abstract function that should be implemented by child
 */
Polyline.prototype.deleteVertex = function() {
};

/**
 * Append new vertex to end of vertex sequence
 * @param {object} pt: the new vertex to be inserted
 */
Polyline.prototype.pushVertex = function(pt) {
  this.insertVertex(this.vertices.length, pt);
};

/**
 * Delete the last vertex.
 */
Polyline.prototype.popVertex = function() {
  this.deleteVertex(this.vertices.length - 1);
};

/**
 * Find index of a vertex.
 * @param {object} v: the target vertex.
 * @return {int}: index of the vertex, -1 if vertex not found.
 */
Polyline.prototype.indexOf = function(v) {
  let index = -1;
  for (let i = 0; i < this.vertices.length; i++) {
    if (v.equals(this.vertices[i])) {
      index = i;
      break;
    }
  }
  return index;
};

Polyline.prototype.toJson = function() {
  this.alignEdges();
  let vertexJsons = [];
  let edgeJsons = [];
  for (let v of this.vertices) {
    vertexJsons.push(v.toJson());
  }
  for (let e of this.edges) {
    edgeJsons.push(e.toJson());
  }
  return {
    id: this.id,
    vertices: vertexJsons,
    edges: edgeJsons,
  };
};

Polyline.fromJson = function(json) {
  let polyline = new this.prototype.constructor(json.id);
  let vertexJsons = json.vertices;
  let edgeJsons = json.edges;
  for (let vertexJson of vertexJsons) {
    polyline.vertices.push(Vertex.fromJson(vertexJson));
  }
  for (let edgeJson of edgeJsons) {
    polyline.edges.push(Edge.fromJson(edgeJson));
  }
  polyline.endPath();
  return polyline;
};

Polyline.fromExportFormat = function(json) {
  let polyline = new this.prototype.constructor();
  let controlPoints = [];
  for (let i = 0; i < json.vertices.length; i++) {
    if (json.types.charAt(i) === 'L') {
      if (controlPoints.length > 0) {
        let newVertex = new Vertex(json.vertices[i][0], json.vertices[i][1]);
        polyline.pushVertex(newVertex,
            new Edge(polyline.vertices[polyline.vertices.length - 1],
                newVertex, EdgeTypes.BEZIER, null, controlPoints));
        controlPoints = [];
      } else {
        polyline.pushVertex(
            new Vertex(json.vertices[i][0], json.vertices[i][1]));
      }
    } else if (json.types.charAt(i) === 'C') {
      controlPoints.push(new Vertex(json.vertices[i][0], json.vertices[i][1],
          VertexTypes.CONTROL_POINT));
    }
  }
  if (controlPoints.length > 0) {
    polyline.edges[polyline.edges.length - 1].type = EdgeTypes.BEZIER;
    polyline.edges[polyline.edges.length - 1].control_points = controlPoints;
  }
  polyline.endPath();
  return polyline;
};

// Reference safe deep copy by serialization
Polyline.prototype.copy = function(temporary = null) {
  // this = Polyline.prototype
  let polyline = new this.constructor(temporary);
  for (let v of this.vertices) {
    polyline.vertices.push(v.copy(temporary));
  }
  for (let i = 0; i < this.edges.length; i++) {
    let edge = this.edges[i];
    let controlPoints = [];
    for (let c of edge.control_points) {
      controlPoints.push(c.copy(temporary));
    }
    polyline.edges.push(
        new Edge(polyline.vertices[i % polyline.vertices.length],
            polyline.vertices[(i + 1) % polyline.vertices.length],
            edge.type, temporary, controlPoints));
  }
  polyline.endPath();
  return polyline;
};

// debug purpose only
Polyline.prototype.toString = function() {
  let vertices = [];
  let edges = [];
  for (let v of this.vertices) {
    // vertices.push(String(v.id));
    vertices.push(String(v.xy));
  }
  for (let e of this.edges) {
    edges.push(String([e.src.xy, e.dest.xy]));
    // edges.push(String([e.src.id, e.dest.id]));
  }
  return [vertices.join(', '), edges.join(', ')].join('\n');
};

/**
 * Path Class, a data structure for Path annotation that holds
 * information about a Path
 * IMPORTANT: keep in mind src and dest of edges can be
 * shuffled randomly, so call this.alignEdges to
 * align edges to correct direction before draw Path
 * @param {number} id - id of the shape. Needed only when loading saved shapes.
 */
export function Path(id = null) {
  Polyline.call(this, id);
}

Object.assign(Path, Polyline);
Path.prototype = Object.create(Polyline.prototype);
Path.prototype.constructor = Path;

Path.prototype.reverse = function() {
  this.vertices = this.vertices.reverse();
  this.edges = this.edges.reverse();
  this.alignEdges();
};

Path.prototype.isEnded = function() {
  return this.ended;
};

/**
 * Insert vertex to path at given position i
 * Assuming prev and next vertices are connected by line, not bezier
 * @param {int} i: index to insert the new vertex
 * @param {Vertex} pt: the new vertex to be inserted
 */
Path.prototype.insertVertex = function(i, pt) {
  // check index i
  if (i < 0 || i > this.vertices.length) {
    return;
  }
  this.vertices.splice(i, 0, pt);
  let edge;
  if (this.vertices.length > 1) {
    if (this.edges.length === 0) {
      edge = new Edge(
          this.vertices[i - 1], this.vertices[i],
          EdgeTypes.LINE, this.subShapeId
      );
    } else if (i === 0) {
      // insert vertex in the front
      edge = new Edge(
          this.vertices[i], this.vertices[i + 1],
          EdgeTypes.LINE, this.subShapeId
      );
    } else if (i === this.vertices.length - 1) {
      // insert vertex at the end
      edge = new Edge(
          this.vertices[i - 1], this.vertices[i],
          EdgeTypes.LINE, this.subShapeId
      );
    } else {
      // insert vertex between two existing ones
      this.edges[i - 1].dest = this.vertices[i];
      this.edges[i - 1].initControlPoints();
      edge = new Edge(
          this.vertices[i], this.vertices[i + 1],
          EdgeTypes.LINE, this.subShapeId
      );
    }
    this.edges.splice(i, 0, edge);
  }
};

/**
 * Delete vertex from Path at given position i
 * @param {int} i: index for the vertex
 */
Path.prototype.deleteVertex = function(i) {
  // return if i is out of index
  if (i < 0 || i >= this.vertices.length) {
    return;
  }
  if (this.vertices.length > 1) {
    if (i > 0 && i < this.vertices.length - 1) {
      let edge = new Edge(this.vertices[i - 1], this.vertices[i + 1],
          EdgeTypes.LINE, this.subShapeId);
      this.edges.splice(i, 1);
      this.edges.splice(i - 1, 1, edge);
    } else if (i === 0) {
      this.edges.splice(i, 1);
    } else if (i === this.vertices.length - 1) {
      this.edges.splice(i - 1, 1);
    }
  } else {
    this.edges = [];
  }

  this.vertices.splice(i, 1);
};

Path.prototype.equals = function(p) {
  let numVertexMatch = this.vertices.length === p.vertices.length;
  if (!numVertexMatch) {
    return false;
  }
  let numEdgeMatch = this.edges.length === p.edges.length;
  if (!numEdgeMatch) {
    return false;
  }
  if (this.vertices[0] && !this.vertices[0].equals(p.vertices[0])) {
    p.reverse();
  }
  for (let i = 0; i < this.vertices.length; i++) {
    if (!this.vertices[i].equals(p.vertices[i])) {
      return false;
    }
  }
  for (let i = 0; i < this.edges.length; i++) {
    if (!this.edges[i].equals(p.edges[i])) {
      return false;
    }
  }
  return true;
};

/**
 * Polygon Class, a data structure for Seg2d that holds
 * information about a polygon
 * IMPORTANT: keep in mind src and dest of edges can be
 * shuffled randomly, so call this.alignEdges to
 * align edges to correct direction before draw polygon
 * @param {number} id - id of the shape. Needed only when loading saved shapes.
 */
export function Polygon(id = null) {
  Polyline.call(this, id);
  this.closed = true;
}

Object.assign(Polygon, Polyline);
Polygon.prototype = Object.create(Polyline.prototype);
Polygon.prototype.constructor = Polygon;

Polygon.prototype.reverse = function() {
  this.vertices = this.vertices.reverse();
  this.vertices.unshift(this.vertices.pop());
  this.edges = this.edges.reverse();
  this.alignEdges();
};

/**
 * Insert vertex to polygon at given position i
 * Assuming prev and next vertices are connected by line, not bezier
 * @param {int} i: index to insert the new vertex
 * @param {Vertex} pt: the new vertex to be inserted
 */
Polygon.prototype.insertVertex = function(i, pt) {
  // check index i
  if (i < 0 || i > this.vertices.length) {
    return;
  }
  this.vertices.splice(i, 0, pt);
  if (this.vertices.length > 1) {
    if (this.edges.length === 0) {
      let edge1 = new Edge(
          this.vertices[idx(i - 1, this.vertices.length)], this.vertices[i],
          EdgeTypes.LINE, this.subShapeId
      );
      this.edges.splice(idx(i - 1, this.edges.length), 1, edge1);
    } else {
      this.edges[idx(i - 1, this.edges.length)].dest = this.vertices[i];
      this.edges[idx(i - 1, this.edges.length)].initControlPoints();
    }
    let edge2 = new Edge(
        this.vertices[i], this.vertices[idx(i + 1, this.vertices.length)],
        EdgeTypes.LINE, this.subShapeId
    );
    this.edges.splice(i, 0, edge2);
  }
};

/**
 * Delete vertex from polygon at given position i
 * @param {int} i: id for the polygon
 */
Polygon.prototype.deleteVertex = function(i) {
  // return if i is out of index
  if (i < 0 || i >= this.vertices.length) {
    return;
  }

  this.vertices.splice(i, 1);
  if (this.vertices.length > 1) {
    let edge = new Edge(
        this.vertices[idx(i - 1, this.vertices.length)],
        this.vertices[idx(i, this.vertices.length)],
        EdgeTypes.LINE, this.subShapeId
    );
    this.edges.splice(i, 1);
    this.edges.splice(idx(i - 1, this.edges.length), 1, edge);
  } else {
    this.edges = []; // doesn't allow edge with length 0
  }
};

/**
 * Get the path between two given vertices
 * @param {object} vStart
 * @param {object} vEnd
 * @return {*}
 */
Polygon.prototype.getPathBetween = function(vStart, vEnd) {
  let startIndex = this.indexOf(vStart);
  let endIndex = this.indexOf(vEnd);
  if (startIndex === -1 || endIndex === -1) {
    return {short: [[], []], long: [[], []]};
  }
  if (startIndex === endIndex) {
    return {short: [[vStart], []], long: [[vStart], []]};
  }
  let startIndexR = this.vertices.length - startIndex;
  let endIndexR = this.vertices.length - endIndex;
  if (endIndex < startIndex) {
    endIndex = endIndex + this.vertices.length;
  }
  if (endIndexR < startIndexR) {
    endIndexR = endIndexR + this.vertices.length;
  }
  let vertices = [];
  for (let i = startIndex; i <= endIndex; i++) {
    vertices.push(this.vertices[idx(i, this.vertices.length)]);
  }
  let edges = [];
  let length = 0;
  for (let i = startIndex; i < endIndex; i++) {
    edges.push(this.edges[idx(i, this.edges.length)]);
    length = length + this.edges[idx(i, this.edges.length)].length;
  }
  this.reverse();
  let verticesR = [];
  for (let i = startIndexR; i <= endIndexR; i++) {
    verticesR.push(this.vertices[idx(i, this.vertices.length)]);
  }
  let edgesR = [];
  let lengthR = 0;
  for (let i = startIndexR; i < endIndexR; i++) {
    edgesR.push(this.edges[idx(i, this.edges.length)]);
    lengthR = lengthR + this.edges[idx(i, this.edges.length)].length;
  }
  this.reverse();
  if (length <= lengthR) {
    return {short: [vertices, edges], long: [verticesR, edgesR]};
  }
  return {short: [verticesR, edgesR], long: [vertices, edges]};
};

/**
 * Push a new path of vertices to the end of this polygon.
 * Handles the case where vStart/vEnd is already in this poly.
 * @param {object} targetPoly: the polygon from which the path is copied.
 * @param {object} vStart: the starting vertex of the path.
 * @param {object} vEnd: the ending vertex of the path.
 * @param {bool} longPath: for switching to longer path selection.
 * @param {bool} temporary: whether or not the pushed path is temporary
 */
Polygon.prototype.pushPath = function(targetPoly, vStart, vEnd,
        longPath = false, temporary = false) {
  let subShapeId = null;
  if (temporary) {
    subShapeId = -1;
  }
  let paths = targetPoly.getPathBetween(vStart, vEnd);
  let vertices;
  let edges;
  if (longPath) {
    [vertices, edges] = paths.long;
  } else {
    [vertices, edges] = paths.short;
  }
  if (this.vertices.length > 1) {
    this.edges.pop();
  }
  if (this.vertices.length > 0
      && vStart.equals(this.vertices[this.vertices.length - 1])) {
    this.vertices.pop();
    this.edges.pop();
  }
  if (this.vertices.length > 0) {
    this.edges.push(new Edge(this.vertices[this.vertices.length - 1], vStart,
        EdgeTypes.LINE, subShapeId));
  }
  this.vertices = this.vertices.concat(vertices);
  for (let edge of edges) {
    if (edge.type === EdgeTypes.LINE) {
      this.edges.push(new Edge(edge.src, edge.dest, edge.type, subShapeId));
    } else if (edge.type === EdgeTypes.BEZIER) {
      this.edges.push(new Edge(edge.src, edge.dest, edge.type,
          subShapeId, [edge.control_points[0], edge.control_points[1]]));
    }
  }
  if (this.vertices.length > 0
      && vEnd.equals(this.vertices[0])) {
    this.vertices.pop();
  } else {
    this.edges.push(new Edge(vEnd, this.vertices[0],
        EdgeTypes.LINE, subShapeId));
  }
};

Polygon.prototype.equals = function(p) {
  let numVertexMatch = this.vertices.length === p.vertices.length;
  if (!numVertexMatch) {
    return false;
  }
  let numEdgeMatch = this.edges.length === p.edges.length;
  if (!numEdgeMatch) {
    return false;
  }
  let vertex = this.vertices[0];
  let index = p.indexOf(vertex);
  if (index === -1) {
    return false;
  }
  let reversed = this.vertices[1].equals(
      p.vertices[idx(index - 1, p.vertices.length)]);
  let direction = reversed ? -1 : 1;
  let offset = reversed ? -1 : 0;
  for (let i = 0; i < this.vertices.length; i++) {
    if (!this.vertices[i].equals(
        p.vertices[idx(index + direction * i, p.vertices.length)])) {
      return false;
    }
  }
  for (let i = 0; i < this.edges.length; i++) {
    if (!this.edges[i].equals(
        p.edges[idx(index + direction * i + offset, p.edges.length)])) {
      return false;
    }
  }
  return true;
};

/**
 * The Rectangle object for box2d annotation.
 * @param {number} x - The x coordinate of the upper-left corner.
 * @param {number} y - The y coordinate of the upper-left corner.
 * @param {number} w - The width of the rectangle.
 * @param {number} h - The height of the rectangle.
 * @param {number} id - id of the shape. Needed only when loading saved shapes.
 * @constructor
 */
export function Rect(x = -1, y = -1, w = -1, h = -1, id = null) {
  Shape.call(this, id);
  this.vertices = [];
  for (let i = 0; i < 8; i++) {
    this.vertices.push(new Vertex());
    if (i % 2 === 1) {
      this.vertices[i].type = VertexTypes.MIDPOINT;
    }
  }
  if (x >= 0 && y >= 0 && w >= 0 && h >= 0) {
    this.setRect(x, y, w, h);
  }
}

Rect.prototype = Object.create(Shape.prototype);

Object.defineProperty(Rect.prototype, 'x', {
  get: function() {
    return Math.min(this.vertices[0].x, this.vertices[4].x);
  },
});

Object.defineProperty(Rect.prototype, 'y', {
  get: function() {
    return Math.min(this.vertices[0].y, this.vertices[4].y);
  },
});

Object.defineProperty(Rect.prototype, 'w', {
  get: function() {
    return Math.abs(this.vertices[0].x
        - this.vertices[4].x);
  },
});

Object.defineProperty(Rect.prototype, 'h', {
  get: function() {
    return Math.abs(this.vertices[0].y
        - this.vertices[4].y);
  },
});

/*
 * Update the rectangle with vertices in canonical order
 */
Rect.prototype.setRect = function(x, y, w, h) {
  this.vertices[0].xy = [x, y];
  this.vertices[2].xy = [x + w, y];
  this.vertices[4].xy = [x + w, y + h];
  this.vertices[6].xy = [x, y + h];
  this.updateMidpoints();
};

/**
 * Update midpoints based on vertices.
 */
Rect.prototype.updateMidpoints = function() {
  for (let i = 1; i < 8; i += 2) {
    this.getVertex(i).x = (this.getVertex(i + 1).x
        + this.getVertex(i - 1).x) / 2;
    this.getVertex(i).y = (this.getVertex(i + 1).y
        + this.getVertex(i - 1).y) / 2;
  }
};

/**
 * Copy this rectangle.
 * @param {object} temporary - whether the copied shape is temporary
 * @return {Rect} the duplicate.
 */
Rect.prototype.copy = function(temporary=null) {
  let newRect = new Rect(temporary);
  newRect.setRect(this.x, this.y, this.w, this.h);
  return newRect;
};

Rect.prototype.getHandleNo = function(handle) {
  for (let i = 0; i < this.vertices.length; i++) {
    if (handle === this.vertices[i]) {
      return i;
    }
  }
  return -1;
};

Rect.prototype.oppositeHandleNo = function(handleNo) {
  let numVertices = this.vertices.length;
  return (handleNo + numVertices / 2) % numVertices;
};

Rect.prototype.getVertex = function(index) {
  return this.vertices[(index + this.vertices.length) % this.vertices.length];
};

Rect.fromJson = function(json) {
  let rect = new Rect(json.id);
  rect.setRect(json.x, json.y, json.w, json.h);
  return rect;
};

Rect.prototype.toJson = function() {
  return {
    id: this.id,
    x: this.x,
    y: this.y,
    w: this.w,
    h: this.h,
  };
};

/**
 * Drawing Utilities
 */
export const UP_RES_RATIO = 2;
// Need to multiply by UP_RES_RATIO for every size definition
const HOVERED_HANDLE_RADIUS = 6 * UP_RES_RATIO;
const HIDDEN_LINE_WIDTH = 5 * UP_RES_RATIO;
const HANDLE_RADIUS = 4 * UP_RES_RATIO;
const HIDDEN_HANDLE_RADIUS = 6 * UP_RES_RATIO;

export const LINE_WIDTH = 2 * UP_RES_RATIO;
export const OUTLINE_WIDTH = 2 * UP_RES_RATIO;

export const BEZIER_COLOR = 'rgba(200,200,100,0.7)';
export const GRAYOUT_COLOR = [169, 169, 169];
export const SELECT_COLOR = [100, 0, 100];
const CONTROL_FILL_COLOR = [255, 255, 255];
const CONTROL_LINE_COLOR = [0, 0, 0];

export const ALPHA_HIGH_FILL = 0.5;
export const ALPHA_LOW_FILL = 0.3;
export const ALPHA_LINE = 1.0;
export const ALPHA_CONTROL_POINT = 0.5;

/**
 * Draw the vertex.
 * @param {object} context - Canvas context.
 * @param {SatImage} satImage - the SatImage object.
 * @param {[number]} fillStyle - the style to fill the vertex.
 * @param {number} radius - the radius of the vertex on canvas.
 */
Vertex.prototype.draw = function(context, satImage, fillStyle = null,
                                 radius = HANDLE_RADIUS) {
  context.save();
  context.beginPath();
  context.fillStyle = fillStyle;
  let [x, y] = satImage.toCanvasCoords([this._x, this._y]);
  context.arc(x, y, radius, 0, 2 * Math.PI, false);
  context.closePath();
  if (this.type === VertexTypes.CONTROL_POINT
      || this.type === VertexTypes.MIDPOINT) {
    context.fillStyle = rgba(CONTROL_FILL_COLOR, ALPHA_CONTROL_POINT);
    context.strokeStyle = rgba(CONTROL_LINE_COLOR, ALPHA_CONTROL_POINT);
  }
  context.fill();
  context.restore();
};

Vertex.prototype.drawHidden = function(context, satImage, fillStyle) {
  context.save();
  let [x, y] = satImage.toCanvasCoords([this._x, this._y]);
  context.strokeStyle = fillStyle;
  context.fillStyle = fillStyle;
  context.beginPath();
  context.arc(x, y, HIDDEN_HANDLE_RADIUS, 0, 2 * Math.PI, false);
  context.closePath();
  context.fill();
  context.restore();
};

/**
 * draw an edge, assuming mouse already at src,
 * need to call beginPath and moveTo before
 * drawing the first edge in poly, and closePath
 * after last poly
 * @param {object} context: context to draw the edge
 * @param {SatImage} satImage: the SatImage object
 */
Edge.prototype.draw = function(context, satImage) {
  context.save();
  let [destX, destY] = satImage.toCanvasCoords([this.dest[0], this.dest[1]]);
  switch (this.type) {
    case EdgeTypes.LINE: {
      context.lineTo(destX, destY);
      break;
    }
    case EdgeTypes.BEZIER: {
      let [c1X, c1Y] = satImage.toCanvasCoords([
        this.control_points[0].x, this.control_points[0].y]);
      let [c2X, c2Y] = satImage.toCanvasCoords([
        this.control_points[1].x, this.control_points[1].y]);
      context.bezierCurveTo(c1X, c1Y, c2X, c2Y, destX, destY);
      break;
    }
  }
  context.restore();
};

/**
 * draw an edge on the hidden canvas, assuming mouse already at src,
 * need to call beginPath and moveTo before
 * drawing the first edge in poly, and closePath
 * after last poly
 * @param {object} hiddenCtx: context to draw the edge
 * @param {SatImage} satImage: the SatImage object
 */
Edge.prototype.drawHidden = function(hiddenCtx, satImage) {
  this.draw(hiddenCtx, satImage);
};

Edge.prototype.hasVertices = function(v1, v2) {
  return (this.src === v1 && this.dest === v2) ||
      (this.src === v2 && this.dest === v1);
};

/**
 * Draw the polygon.
 * @param {object} ctx - Canvas context.
 * @param {SatImage} satImage - the SatImage object.
 * @param {boolean} drawDash - optional arguments for drawing dashed lines.
 */
Polyline.prototype.draw = function(ctx, satImage, drawDash) {
  if (this.vertices.length === 0) {
    return;
  }
  ctx.save();
  // start path
  ctx.beginPath();
  this.alignEdges(); // this is important
  let [startX, startY] = satImage.toCanvasCoords(
      [this.vertices[0].x, this.vertices[0].y]);
  ctx.moveTo(startX, startY);
  if (this.edges.length > 0) {
    for (let edge of this.edges) {
      let [destX, destY] = satImage.toCanvasCoords(
          [edge.dest.x, edge.dest.y]);
      if (edge.type === EdgeTypes.LINE) {
        ctx.lineTo(destX, destY);
      } else if (edge.type === EdgeTypes.BEZIER) {
        let [c1x, c1y] = satImage.toCanvasCoords([
          edge.control_points[0].x,
          edge.control_points[0].y]);
        let [c2x, c2y] = satImage.toCanvasCoords([
          edge.control_points[1].x,
          edge.control_points[1].y]);
        ctx.bezierCurveTo(c1x, c1y, c2x, c2y, destX, destY);
      }
    }
  }

  if (this.closed) {
    ctx.closePath();
    ctx.fill();
  }
  ctx.stroke();

  // draw dashed line for bezier if targeted
  if (drawDash) {
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([6, 2]);
    ctx.strokeStyle = BEZIER_COLOR;
    for (let edge of this.edges) {
      if (edge.type === EdgeTypes.BEZIER) {
        let [srcX, srcY] = satImage.toCanvasCoords(
            [edge.src._x, edge.src._y]);
        let [destX, destY] = satImage.toCanvasCoords(
            [edge.dest._x, edge.dest._y]);
        let [c1x, c1y] = satImage.toCanvasCoords([
          edge.control_points[0].x,
          edge.control_points[0].y]);
        let [c2x, c2y] = satImage.toCanvasCoords([
          edge.control_points[1].x,
          edge.control_points[1].y]);

        ctx.moveTo(srcX, srcY);
        ctx.lineTo(c1x, c1y);
        ctx.lineTo(c2x, c2y);
        ctx.lineTo(destX, destY);
      }
    }
    ctx.stroke();
    ctx.closePath();
    ctx.restore();
  }
  ctx.restore();
};

/**
 * Draw all handles on the given context.
 * @param {object} context: context to draw the edge
 * @param {SatImage} satImage: the SatImage object.
 * @param {[number]} fillStyle: the style for filling.
 * @param {object} hoveredHandle: the handle hovered on.
 * @param {boolean} drawControlPoints: whether or not to draw control points
 */
Polyline.prototype.drawHandles = function(context, satImage, fillStyle,
                                          hoveredHandle, drawControlPoints) {
  let vertices = this.vertices;
  if (this.isEnded() && drawControlPoints) {
    vertices = vertices.concat(this.control_points);
  }
  for (let v of vertices) {
    if (v.equals(hoveredHandle)) {
      v.draw(context, satImage, fillStyle, HOVERED_HANDLE_RADIUS);
    } else {
      v.draw(context, satImage, fillStyle);
    }
  }
};

/**
 * Draw the polyline on the hidden canvas.
 * @param {object} hiddenCtx - Hidden canvas context.
 * @param {SatImage} satImage - The SatImage object.
 * @param {string} fillStyle - The fill style on hidden canvas.
 */
Polyline.prototype.drawHidden = function(hiddenCtx, satImage, fillStyle) {
  if (this.vertices.length === 0) {
    return;
  }
  hiddenCtx.save(); // save the canvas context settings
  hiddenCtx.strokeStyle = fillStyle;
  hiddenCtx.fillStyle = fillStyle;
  hiddenCtx.lineWidth = HIDDEN_LINE_WIDTH;
  this.alignEdges();

  // draw polygon
  hiddenCtx.beginPath();
  let [startX, startY] = satImage.toCanvasCoords(
      [this.vertices[0].x, this.vertices[0].y]);
  hiddenCtx.moveTo(startX, startY);
  if (this.edges.length > 0) {
    for (let edge of this.edges) {
      let [x, y] = satImage.toCanvasCoords([edge.dest.x, edge.dest.y]);
      if (edge.type === EdgeTypes.LINE) {
        hiddenCtx.lineTo(x, y);
      } else if (edge.type === EdgeTypes.BEZIER) {
        let [c1x, c1y] = satImage.toCanvasCoords([
          edge.control_points[0].x,
          edge.control_points[0].y]);
        let [c2x, c2y] = satImage.toCanvasCoords([
          edge.control_points[1].x,
          edge.control_points[1].y]);
        hiddenCtx.bezierCurveTo(c1x, c1y, c2x, c2y, x, y);
      }
    }
  }
  if (this.closed) {
    hiddenCtx.closePath();
    hiddenCtx.fill();
  }
  hiddenCtx.stroke();
  hiddenCtx.restore(); // restore the canvas to saved settings
};

/**
 * Draw the polygon.
 * @param {object} ctx - Canvas context.
 * @param {SatImage} satImage - the SatImage object.
 * @param {boolean} dashed - whether or not to draw in dashed lines.
 */
Rect.prototype.draw = function(ctx, satImage, dashed) {
  ctx.save();

  let [x, y] = satImage.toCanvasCoords([this.x, this.y]);
  let [w, h] = satImage.toCanvasCoords([this.w, this.h], false);

  if (dashed) {
    ctx.setLineDash([6, 2]);
  }
  ctx.lineWidth = LINE_WIDTH;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
};

/**
 * Draw all handles on the given context,
 * Assumes Caller handles stroke and fill coloring
 * @param {object} context: context to draw the edge
 * @param {SatImage} satImage: the SatImage object.
 * @param {[number]} fillStyle: the style for filling.
 * @param {object} hoveredHandle: the handle hovered on.
 */
Rect.prototype.drawHandles = function(context, satImage, fillStyle,
                                      hoveredHandle) {
  context.save();
  for (let v of this.vertices) {
    if (hoveredHandle && v === hoveredHandle) {
      v.draw(context, satImage, fillStyle, HOVERED_HANDLE_RADIUS);
    } else {
      v.draw(context, satImage, fillStyle);
    }
  }
  context.restore();
};

/**
 * Draw the rectangle.
 * @param {object} hiddenCtx - Canvas context.
 * @param {SatImage} satImage - the SatImage object.
 * @param {string} strokeStyle - The stroke style on hidden canvas.
 */
Rect.prototype.drawHidden = function(hiddenCtx, satImage, strokeStyle) {
  hiddenCtx.save();
  let [x, y] = satImage.toCanvasCoords([this.x, this.y]);
  let [w, h] = satImage.toCanvasCoords([this.w, this.h], false);

  hiddenCtx.lineWidth = HIDDEN_LINE_WIDTH;
  hiddenCtx.strokeStyle = strokeStyle;
  hiddenCtx.strokeRect(x, y, w, h);
  hiddenCtx.restore();
};
