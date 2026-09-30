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
    // How it mixes with what is behind (EntityBlend): 'alpha' (the
    // default: EntityAlpha and the texture's alpha), 'multiply' or 'add'.
    this.blend = 'alpha';
    this.texture = null;
    // From model files: how alpha is used ('opaque', 'mask' below
    // alphaCutoff is not drawn, 'blend'), or null to go by `alpha` as the
    // built-in shapes do; and whether the mesh's vertex colours tint it.
    this.alphaMode = null;
    this.alphaCutoff = 0.5;
    this.vertexColors = false;
    this.vertexAlpha = false;   // FX_VERTEXALPHA: the vertex colours' alpha blends
    this.decal = false;         // drawn over the surface it lies on
    this.name = '';
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
    m.blend = this.blend;
    m.texture = this.texture;
    m.alphaMode = this.alphaMode;
    m.alphaCutoff = this.alphaCutoff;
    m.vertexColors = this.vertexColors;
    m.vertexAlpha = this.vertexAlpha;
    m.decal = this.decal;
    m.name = this.name;
    return m;
  }
}
