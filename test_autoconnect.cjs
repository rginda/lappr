const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

async function test() {
  const htmlPath = path.resolve(__dirname, 'public/index.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');
  
  const dom = new JSDOM(html, {
    url: "http://localhost/",
    runScripts: "dangerously",
    resources: "usable",
    beforeParse(window) {
      window.localStorage = {
        store: {
          'lappr-settings': JSON.stringify({
            connectAtStartup: true,
            hardwareType: 'mock',
            minLapTime: 3,
            maxLapTime: 25
          })
        },
        getItem(key) { return this.store[key] || null; },
        setItem(key, value) { this.store[key] = value.toString(); },
        clear() { this.store = {}; }
      };
      
      // Mock SpeechSynthesis
      window.speechSynthesis = {
        getVoices: () => [],
        speak: () => {}
      };
      
      // Mock matchMedia
      window.matchMedia = () => ({ matches: false });
    }
  });

  // Inject script contents
  const dbScript = fs.readFileSync('public/js/database.js', 'utf8');
  const raceScript = fs.readFileSync('public/js/race.js', 'utf8');
  const serialScript = fs.readFileSync('public/js/serial.js', 'utf8');
  const simScript = fs.readFileSync('public/js/simulator.js', 'utf8');
  const speechScript = fs.readFileSync('public/js/speech.js', 'utf8');
  const appScript = fs.readFileSync('public/js/app.js', 'utf8');

  // We can't easily mock ES modules in pure jsdom without vitest, 
  // so let's just grep the file for the logic and print what's going on.
}

test().catch(console.error);
