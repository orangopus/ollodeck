import { listStreamDecks, openStreamDeck } from '@elgato-stream-deck/node';
import { createCanvas, loadImage } from 'canvas';
import { exec } from 'child_process';


let artist = '';
let track = '';
let albumArtwork = null; // To store album artwork image

// Execute a shell command and return stdout trimmed
async function executeCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing command: ${error.message}`);
        reject(error);
      } else if (stderr) {
        console.error(`Error in command output: ${stderr}`);
        reject(new Error(stderr));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

async function togglePlayPause() {
  try {
    await executeCommand('playerctl play-pause');
    console.log('Play/Pause toggled');
  } catch (error) {
    console.error(`Error toggling play/pause: ${error.message}`);
  }
}

async function toggleNext() {
  try {
    await executeCommand('playerctl next');
    console.log('Next track toggled');
  } catch (error) {
    console.error(`Error toggling to next track: ${error.message}`);
  }
}

async function getArtistAndTrack() {
  try {
    const artist = await executeCommand('playerctl metadata artist');
    const track = await executeCommand('playerctl metadata title');
    return { artist, track };
  } catch (error) {
    console.error('Error fetching artist and track:', error.message);
    throw error;
  }
}

async function getAlbumArtwork() {
  try {
    const artworkUrl = await executeCommand('playerctl metadata mpris:artUrl');
    return artworkUrl;
  } catch (error) {
    console.error('Error fetching album artwork URL:', error.message);
    throw error;
  }
}

async function initializeStreamDeck() {
  try {
    // List all connected Stream Deck devices
    const devices = await listStreamDecks();

    if (devices.length === 0) {
      throw new Error('No Stream Decks found');
    }

    // Open the first available Stream Deck
    const myStreamDeck = await openStreamDeck(devices[0].path);
    console.log('Device opened successfully:', myStreamDeck);

    // Ensure the canvas dimensions match the LCD dimensions
    const iconWidth = myStreamDeck.ICON_SIZE;
    const iconHeight = myStreamDeck.ICON_SIZE;
    const lcdWidth = myStreamDeck.LCD_STRIP_SIZE.width;
    const lcdHeight = myStreamDeck.LCD_STRIP_SIZE.height;

    // Create canvases for icon and bar
    const iconCanvas = createCanvas(iconWidth, iconHeight);
    const barCanvas = createCanvas(lcdWidth, lcdHeight);
    const iconCtx = iconCanvas.getContext('2d');
    const barCtx = barCanvas.getContext('2d');

    // Function to update LCD with media information and artwork
    async function updateLCDWithMediaInfo(artist, track, artworkUrl) {
      try {
        // Clear icon canvas
        iconCtx.clearRect(0, 0, iconWidth, iconHeight);
        iconCtx.fillStyle = '#000000'; // black background
        iconCtx.fillRect(0, 0, iconWidth, iconHeight);

        // Load album artwork if available
        if (artworkUrl) {
          albumArtwork = await loadImage(artworkUrl);
          iconCtx.drawImage(albumArtwork, 0, 0, 100, 100); // Adjust position and size
        }

        // Update Stream Deck with icon canvas
        await myStreamDeck.fillKeyBuffer(0, iconCanvas.toBuffer('raw'), { format: 'rgba' });

        // Clear and draw bar canvas
        barCtx.fillStyle = '#ffffff';
        barCtx.fillRect(0, 0, lcdWidth, lcdHeight);
        barCtx.fillStyle = '#000000'; // Example: Green color
        barCtx.font = '15px Noto Sans';
        barCtx.textAlign = 'center';
        barCtx.fillText(`${artist}`, lcdWidth / 2, lcdHeight / 2 - 10);
        barCtx.fillText(`${track}`, lcdWidth / 2, lcdHeight / 2 + 20);
        barCtx.fillRect((lcdWidth - lcdWidth * 0.5) / 2, (lcdHeight - lcdHeight * 0.1) / 2, lcdWidth * 0.5, lcdHeight * 0.1);

        // Update Stream Deck with bar canvas
        await myStreamDeck.fillLcd(barCanvas.toBuffer('raw'), { format: 'rgba' });
      } catch (error) {
        console.error('Error updating LCD:', error.message);
      }
    }

    // Event listener for Stream Deck key presses
    myStreamDeck.on('up', async (keyIndex) => {
      try {
        if (keyIndex === 0) {
          await togglePlayPause();
        } else if (keyIndex === 1) {
          await toggleNext();
        } else if (keyIndex === 2) {
          const { artist, track } = await getArtistAndTrack();
          const artworkUrl = await getAlbumArtwork();
          await updateLCDWithMediaInfo(artist, track, artworkUrl);
        }
      } catch (error) {
        console.error('Error handling Stream Deck key press:', error.message);
      }
    });

    // Periodically update Stream Deck with media information
    setInterval(async () => {
      try {
        const { artist, track } = await getArtistAndTrack();
        const artworkUrl = await getAlbumArtwork();
        await updateLCDWithMediaInfo(artist, track, artworkUrl);
      } catch (error) {
        console.error('Error updating Stream Deck:', error.message);
      }
    }, 1000); // Update every 5 seconds

  } catch (error) {
    console.error('Error initializing Stream Deck:', error.message);
  }
}

// Initialize the Stream Deck
initializeStreamDeck();
