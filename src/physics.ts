import type { Bounds, Direction, Vector2 } from './types';

export interface PhysicsBody {
  position: Vector2;
  velocity: Vector2;
}

export interface PhysicsResult {
  hitHorizontal: Direction | null;
  hitVertical: Direction | null;
  landed: boolean;
}

const EDGE_BOUNCE = 0.58;
const AIR_FRICTION_PER_FRAME = 0.965;

export const createBody = (position: Vector2): PhysicsBody => ({
  position: { ...position },
  velocity: { x: 0, y: 0 }
});

export const stepPhysics = (
  body: PhysicsBody,
  bounds: Bounds,
  deltaSeconds: number
): PhysicsResult => {
  const result: PhysicsResult = {
    hitHorizontal: null,
    hitVertical: null,
    landed: false
  };

  const damping = Math.pow(AIR_FRICTION_PER_FRAME, deltaSeconds * 60);
  body.velocity.x *= damping;
  body.velocity.y *= damping;
  body.position.x += body.velocity.x * deltaSeconds;
  body.position.y += body.velocity.y * deltaSeconds;

  if (body.position.x <= bounds.minX) {
    body.position.x = bounds.minX;
    body.velocity.x = Math.abs(body.velocity.x) * EDGE_BOUNCE;
    result.hitHorizontal = 1;
  }

  if (body.position.x >= bounds.maxX) {
    body.position.x = bounds.maxX;
    body.velocity.x = -Math.abs(body.velocity.x) * EDGE_BOUNCE;
    result.hitHorizontal = -1;
  }

  if (body.position.y >= bounds.maxY) {
    body.position.y = bounds.maxY;
    body.velocity.y = -Math.abs(body.velocity.y) * EDGE_BOUNCE;
    result.hitVertical = -1;
  }

  if (body.position.y < bounds.minY) {
    body.position.y = bounds.minY;
    body.velocity.y = Math.abs(body.velocity.y) * EDGE_BOUNCE;
    result.hitVertical = 1;
  }

  result.landed = isBodySettled(body);

  return result;
};

export const isBodySettled = (body: PhysicsBody): boolean =>
  Math.abs(body.velocity.x) < 12 && Math.abs(body.velocity.y) < 12;
