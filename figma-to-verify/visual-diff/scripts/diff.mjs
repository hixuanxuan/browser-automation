import looksSame from 'looks-same';
import {resolve} from 'path';

const [, , img1, img2, output] = process.argv;

if (!img1 || !img2 || !output) {
    console.error('Usage: node diff.mjs <img1> <img2> <output>');
    process.exit(1);
}

await looksSame.createDiff({
    reference: resolve(img1),
    current: resolve(img2),
    diff: resolve(output),
    highlightColor: '#ff0000',
    strict: false,
});

console.log(`Diff saved to ${output}`);
