/**
 * Map bridge for the company library: the only part of Ohjiya X that talks to
 * the globe. It picks points and areas by click, draws the library's saved
 * places and areas in its own data source (so it never touches the Draw
 * board), and flies the camera. The panel in library.js reaches it through
 * `window.__oxMap`.
 */
import * as Cesium from 'cesium';
import { pickWorldFromScreen } from '../annotations/annotationResolver.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { claimPointer, releasePointer } from '../data/inputOwnership.js';
import { statusColor, tagColor } from './libraryModel.js';

const OWNER = 'ohjiya-library';
const OVERLAY_SOURCE = 'ohjiya-library';
const MAX_PICK_POINTS = 200;

export function initMapBridge({ viewer }) {
  if (!viewer) return null;
  const source = new Cesium.CustomDataSource('ohjiya-library');
  const preview = new Cesium.CustomDataSource('ohjiya-library-preview');
  void viewer.dataSources.add(source);
  void viewer.dataSources.add(preview);
  let picking = null;

  const render = () => viewer.scene.requestRender();
  const world = (position) => {
    const canvas = viewer.scene.canvas;
    const w = canvas.clientWidth || canvas.width || 1;
    const h = canvas.clientHeight || canvas.height || 1;
    const hit = pickWorldFromScreen(viewer, position.x / w, position.y / h);
    return hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lon)
      ? { lat: hit.lat, lon: hit.lon }
      : null;
  };
  const colour = (tag, alpha = 1) =>
    Cesium.Color.fromCssColorString(tagColor(tag)).withAlpha(alpha);

  /**
   * One pick session: `kind` is 'point' (first click returns) or 'area' (clicks
   * add corners, double-click or Enter finishes, Escape cancels). Resolves null
   * when cancelled or when another tool holds the pointer.
   */
  function pick(kind) {
    if (picking) picking.cancel();
    const lease = claimPointer(OWNER);
    if (!lease) return Promise.resolve(null);
    return new Promise((resolve) => {
      const points = [];
      const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      const stock = viewer.screenSpaceEventHandler;
      const savedClick = stock.getInputAction(
        Cesium.ScreenSpaceEventType.LEFT_CLICK,
      );
      const savedDouble = stock.getInputAction(
        Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
      );
      stock.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
      stock.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      document.body.classList.add('ox-picking');
      let cursor = null;
      const line = preview.entities.add({
        polyline: {
          positions: new Cesium.CallbackProperty(() => {
            const pts = points.map((p) =>
              Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
            );
            if (cursor) pts.push(cursor);
            if (points.length >= 2) pts.push(pts[0]);
            return pts.length >= 2 ? pts : [];
          }, false),
          width: 3,
          clampToGround: false,
          material: Cesium.Color.fromCssColorString('#00d4ff').withAlpha(0.9),
        },
      });
      const dots = [];

      const end = (result) => {
        if (picking?.token !== token) return;
        picking = null;
        handler.destroy();
        document.removeEventListener('keydown', onKey, true);
        document.body.classList.remove('ox-picking');
        if (savedClick)
          stock.setInputAction(
            savedClick,
            Cesium.ScreenSpaceEventType.LEFT_CLICK,
          );
        if (savedDouble)
          stock.setInputAction(
            savedDouble,
            Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
          );
        preview.entities.remove(line);
        for (const dot of dots) preview.entities.remove(dot);
        releasePointer(lease);
        render();
        resolve(result);
      };
      const finishArea = () => (points.length >= 3 ? end([...points]) : null);
      const onKey = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          end(null);
        } else if (event.key === 'Enter' && kind === 'area') {
          event.preventDefault();
          finishArea();
        } else if (
          event.key === 'Backspace' &&
          kind === 'area' &&
          points.length
        ) {
          event.preventDefault();
          points.pop();
          preview.entities.remove(dots.pop());
          render();
        }
      };
      const token = Symbol('pick');
      picking = { token, cancel: () => end(null) };
      document.addEventListener('keydown', onKey, true);

      handler.setInputAction((event) => {
        const p = world(event.position);
        if (!p) return;
        if (kind === 'point') return end(p);
        if (points.length >= MAX_PICK_POINTS) return;
        // The second click of a double-click lands on the same spot.
        const last = points[points.length - 1];
        if (
          last &&
          Math.abs(last.lat - p.lat) < 1e-5 &&
          Math.abs(last.lon - p.lon) < 1e-5
        )
          return;
        points.push(p);
        dots.push(
          preview.entities.add({
            position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
            point: {
              pixelSize: 8,
              color: Cesium.Color.fromCssColorString('#00d4ff'),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          }),
        );
        render();
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      handler.setInputAction(() => {
        cursor = null;
        // The double-click's first click already added its corner.
        if (kind === 'area') finishArea();
      }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      handler.setInputAction((event) => {
        if (kind !== 'area' || !points.length) return;
        const p = world(event.endPosition);
        cursor = p ? Cesium.Cartesian3.fromDegrees(p.lon, p.lat) : null;
        render();
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    });
  }

  /** Draw the library. Replaces what was shown before. */
  function show(items) {
    source.entities.removeAll();
    // Names go through the shared world-overlay host (the app forbids Cesium
    // text labels), so they collide and fade like every other label.
    setOverlayEntries(
      OVERLAY_SOURCE,
      items
        .filter((item) => item.kind === 'place')
        .map((item, index) => ({
          id: `place:${item.id}`,
          position: Cesium.Cartesian3.fromDegrees(item.geom.lon, item.geom.lat),
          variant: 'label',
          title: item.name,
          accent: tagColor(item.tag),
          priority: 1 - index / Math.max(1, items.length + 1),
        })),
    );
    setOverlaySourceVisible(OVERLAY_SOURCE, true);
    for (const item of items) {
      const g = item.geom;
      if (item.kind === 'place') {
        source.entities.add({
          position: Cesium.Cartesian3.fromDegrees(g.lon, g.lat),
          point: {
            pixelSize: 12,
            color: colour(item.tag),
            // The ring is the status: green active, blue planned, amber attention, grey closed.
            outlineColor: Cesium.Color.fromCssColorString(
              statusColor(item.status),
            ),
            outlineWidth: 3,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      } else if (g.type === 'circle') {
        source.entities.add({
          position: Cesium.Cartesian3.fromDegrees(g.lon, g.lat),
          ellipse: {
            semiMajorAxis: g.radius_m,
            semiMinorAxis: g.radius_m,
            material: colour(item.tag, 0.18),
            outline: true,
            outlineColor: colour(item.tag, 0.9),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            classificationType: Cesium.ClassificationType.BOTH,
          },
        });
      } else if (g.type === 'polygon') {
        source.entities.add({
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(
              g.points.flatMap((p) => [p.lon, p.lat]),
            ),
            material: colour(item.tag, 0.18),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            classificationType: Cesium.ClassificationType.BOTH,
          },
        });
      }
    }
    render();
  }

  function flyTo({ lat, lon, altitude = 2500 }) {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, altitude),
      orientation: {
        heading: viewer.camera.heading,
        pitch: Cesium.Math.toRadians(-55),
        roll: 0,
      },
      duration: 1.6,
    });
  }

  const api = {
    pickPoint: () => pick('point'),
    pickArea: () => pick('area'),
    cancel: () => picking?.cancel(),
    centre: () => world({ x: 0, y: 0, ...centreOf(viewer) }),
    show,
    flyTo,
    destroy() {
      picking?.cancel();
      clearOverlaySource(OVERLAY_SOURCE);
      viewer.dataSources.remove(source, true);
      viewer.dataSources.remove(preview, true);
      if (window.__oxMap === api) delete window.__oxMap;
    },
  };
  window.__oxMap = api;
  return api;
}

function centreOf(viewer) {
  const canvas = viewer.scene.canvas;
  return {
    x: (canvas.clientWidth || canvas.width || 2) / 2,
    y: (canvas.clientHeight || canvas.height || 2) / 2,
  };
}
