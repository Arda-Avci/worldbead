import * as THREE from 'three';

/**
 * Builds a sphere whose direction/UV convention exactly matches GDD §3:
 *   x = cos(lat)cos(lon), y = sin(lat), z = -cos(lat)sin(lon)
 *   u = (lon + 180) / 360, v = (90 - lat) / 180
 *
 * three.js's built-in SphereGeometry uses a different convention (its seam
 * and pole axis don't line up with this project's lon/lat mapping used by
 * BeadGlobe), so beads placed with the formula above would not sit on the
 * matching terrain of a stock SphereGeometry. This geometry is generated
 * directly from the same formula so the planet body and the bead shell
 * always agree.
 *
 * Numeric sanity check (see report): lon=0,lat=0 -> dir=(1,0,0)=+X,
 * u=v=0.5 -> texture center, which for a standard equirectangular Earth
 * day map is the Gulf of Guinea / Greenwich meridian. lon=90E,lat=0 ->
 * dir=(0,0,-1)=-Z, u=0.75 -> India, matching the GDD's -Z requirement.
 */
export function createPlanetGeometry(
  radius: number,
  widthSegments = 96,
  heightSegments = 48,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let iy = 0; iy <= heightSegments; iy++) {
    const v = iy / heightSegments;
    const lat = THREE.MathUtils.degToRad(90 - v * 180);
    for (let ix = 0; ix <= widthSegments; ix++) {
      const u = ix / widthSegments;
      const lon = THREE.MathUtils.degToRad(u * 360 - 180);

      const x = Math.cos(lat) * Math.cos(lon);
      const y = Math.sin(lat);
      const z = -Math.cos(lat) * Math.sin(lon);

      positions.push(x * radius, y * radius, z * radius);
      normals.push(x, y, z);
      uvs.push(u, v);
    }
  }

  const rowSize = widthSegments + 1;
  for (let iy = 0; iy < heightSegments; iy++) {
    for (let ix = 0; ix < widthSegments; ix++) {
      const a = iy * rowSize + ix;
      const b = a + rowSize;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/** Direction on the unit sphere for a lon/lat pair, per the GDD §3 convention. */
export function dirFromLonLat(lonDeg: number, latDeg: number): THREE.Vector3 {
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);
  return new THREE.Vector3(
    Math.cos(lat) * Math.cos(lon),
    Math.sin(lat),
    -Math.cos(lat) * Math.sin(lon),
  );
}
