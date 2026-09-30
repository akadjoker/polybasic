// Surface settings of a mesh entity. Colours are 0..1 floats; the backend
// re-reads the material when `version` changes.

let nextMaterialId = 1;

export class Material
{
  constructor()
  {
    this.id = nextMaterialId++;
    this.version = 0;
    this.color = [1, 1, 1];
    this.alpha = 1;
    this.shininess = 0;       // 0 = matte, 1 = very shiny
    this.fullbright = false;  // ignore lights
    this.flat = false;        // faceted instead of smooth shading
    this.twoSided = false;
    this.texture = null;
  }

  changed()
  {
    this.version++;
  }

  clone()
  {
    const m = new Material();
    m.color = [...this.color];
    m.alpha = this.alpha;
    m.shininess = this.shininess;
    m.fullbright = this.fullbright;
    m.flat = this.flat;
    m.twoSided = this.twoSided;
    m.texture = this.texture;
    return m;
  }
}
