const fs = require('fs');

function checkModel(filePath) {
    const buffer = fs.readFileSync(filePath);
    const magic = buffer.toString('utf8', 0, 4);
    if (magic !== 'glTF') {
        console.error('Not a valid GLB file');
        return;
    }
    
    const version = buffer.readUInt32LE(4);
    const length = buffer.readUInt32LE(8);
    
    const chunkLength = buffer.readUInt32LE(12);
    const chunkType = buffer.toString('utf8', 16, 20);
    
    if (chunkType !== 'JSON') {
        console.error('First chunk is not JSON');
        return;
    }
    
    const jsonBuffer = buffer.subarray(20, 20 + chunkLength);
    const gltf = JSON.parse(jsonBuffer.toString('utf8'));
    
    console.log('Model:', filePath);
    console.log('Materials:', gltf.materials ? gltf.materials.length : 0);
    if (gltf.materials) {
        gltf.materials.forEach((mat, i) => {
            console.log(`  Material ${i}: ${mat.name || 'unnamed'}`);
            if (mat.pbrMetallicRoughness) {
                console.log(`    Base Color Texture:`, !!mat.pbrMetallicRoughness.baseColorTexture);
                console.log(`    Metallic Roughness Texture:`, !!mat.pbrMetallicRoughness.metallicRoughnessTexture);
            }
            console.log(`    Normal Texture:`, !!mat.normalTexture);
            console.log(`    Occlusion Texture:`, !!mat.occlusionTexture);
            console.log(`    Emissive Texture:`, !!mat.emissiveTexture);
        });
    }
    
    console.log('Textures:', gltf.textures ? gltf.textures.length : 0);
    console.log('Images:', gltf.images ? gltf.images.length : 0);
}

checkModel('public/models/knight.glb');
