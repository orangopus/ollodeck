import { listStreamDecks, openStreamDeck } from '@elgato-stream-deck/node';
import { createCanvas, loadImage } from 'canvas';
import { exec } from 'child_process';
import SpotifyWebApi from 'spotify-web-api-node';
import express from 'express';
import rpc from 'discord-rich-presence';

const app = express();
const port = 3050;

const clientId = '593477063634059275'; // Replace with your Discord Client ID

const rpcClient = rpc(clientId);

rpcClient.on('error', (error) => {
  console.error('Error occurred in RPC:', error);
});

rpcClient.updatePresence({
  state: 'In a match',
  details: 'Playing a game',
  startTimestamp: Date.now(),
  largeImageKey: 'logo',
  largeImageText: 'Example Game'
});

rpcClient.on('connected', () => {
  console.log('RPC connected');
});

const spotifyApi = new SpotifyWebApi({
  clientId: 'f4c0d55175314b9a843c864e48b863a1',
  clientSecret: '3f30cba020ed435ea8c0dae40069f93d',
  redirectUri: 'http://localhost:3050/callback'
});


let accessToken = null;
let refreshToken = null;

app.get('/login', (req, res) => {
    const scopes = ['user-read-private', 'user-read-email', 'user-read-playback-state', 'user-modify-playback-state'];
    res.redirect(spotifyApi.createAuthorizeURL(scopes));
});

app.get('/callback', async (req, res) => {
    const { error, code } = req.query;
    if (error) {
        console.error('Callback Error:', error);
        return res.status(400).send(`Callback Error: ${error}`);
    }

    try {
        const data = await spotifyApi.authorizationCodeGrant(code);
        const { access_token, refresh_token, expires_in } = data.body;

        spotifyApi.setAccessToken(access_token);
        spotifyApi.setRefreshToken(refresh_token);
        accessToken = access_token;
        refreshToken = refresh_token;

        console.log('Access token:', access_token); // Avoid logging tokens in production
        console.log('Refresh token:', refresh_token);

        res.send('Login successful! You can now use the /search and /play endpoints.');

        setInterval(async () => {
            try {
                const refreshData = await spotifyApi.refreshAccessToken();
                const refreshedAccessToken = refreshData.body['access_token'];
                spotifyApi.setAccessToken(refreshedAccessToken);
                accessToken = refreshedAccessToken;
                console.log('Access token refreshed:', refreshedAccessToken);
            } catch (refreshError) {
                console.error('Error refreshing access token:', refreshError);
            }
        }, (expires_in / 2) * 1000);
    } catch (error) {
        console.error('Error getting Tokens:', error);
        res.status(500).send('Error getting tokens');
    }
});

let albumArtwork = null;

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

async function togglePrev() {
    try {
        await executeCommand('playerctl previous');
        console.log('Previous track toggled');
    } catch (error) {
        console.error(`Error toggling to previous track: ${error.message}`);
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

async function getCurrentPlaybackInfo() {
    try {
        if (!accessToken) {
            throw new Error('No access token available');
        }

        const playbackState = await spotifyApi.getMyCurrentPlaybackState();
        const { progress_ms, item } = playbackState.body;
        const { duration_ms } = item;
        return { progress_ms, duration_ms };
    } catch (error) {
        console.error('Error fetching current playback info:', error.message);
        throw error;
    }
}

function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

async function initializeStreamDeck() {
    try {
        const devices = await listStreamDecks();
        if (devices.length === 0) {
            throw new Error('No Stream Decks found');
        }

        const myStreamDeck = await openStreamDeck(devices[0].path);
        console.log('Stream Deck initialized:', myStreamDeck);

        const iconWidth = myStreamDeck.ICON_SIZE;
        const iconHeight = myStreamDeck.ICON_SIZE;
        const lcdWidth = myStreamDeck.LCD_STRIP_SIZE.width;
        const lcdHeight = myStreamDeck.LCD_STRIP_SIZE.height;

        const iconCanvas = createCanvas(iconWidth, iconHeight);
        const barCanvas = createCanvas(lcdWidth, lcdHeight);
        const iconCtx = iconCanvas.getContext('2d');
        const barCtx = barCanvas.getContext('2d');

        async function updateLCDWithMediaInfo(artist, track, artworkUrl, playbackInfo) {
            try {
                const { progress_ms, duration_ms } = playbackInfo;
                const progressPercentage = progress_ms / duration_ms;
        
                iconCtx.clearRect(0, 0, iconWidth, iconHeight);
                iconCtx.fillStyle = '#000000';
                iconCtx.fillRect(0, 0, iconWidth, iconHeight);

                myStreamDeck.fillKeyColor(8, 0, 255, 0);
                myStreamDeck.fillKeyColor(9, 0, 255, 0);
        
                if (artworkUrl) {
                    albumArtwork = await loadImage(artworkUrl);
                    iconCtx.drawImage(albumArtwork, 0, 0, iconWidth, iconHeight);
                }
        
                await myStreamDeck.fillKeyBuffer(0, iconCanvas.toBuffer('raw'), { format: 'bgra' });
        
                barCtx.fillStyle = '#ffffff';
                barCtx.fillRect(0, 0, lcdWidth, lcdHeight);
                barCtx.fillStyle = '#000000';
                barCtx.font = '15px Noto Sans';
                barCtx.textAlign = 'center';
                
                barCtx.fillText(`${artist}`, lcdWidth / 2, lcdHeight / 2 - 10);
                barCtx.fillText(`${track}`, lcdWidth / 2, lcdHeight / 2 + 20);
        
                // Draw the background of the progress bar
                const barWidth = lcdWidth * 0.5;
                const barHeight = lcdHeight * 0.1;
                const barX = (lcdWidth - barWidth) / 2;
                const barY = (lcdHeight - barHeight) / 2;
                const progressWidth = barWidth * progressPercentage;
        
                roundRect(barCtx, barX, barY, barWidth, barHeight, 3, '#000000'); // Background of the progress bar
                roundRect(barCtx, barX, barY, progressWidth, barHeight, 3, '#00ff00'); // Green color for the progress
        
                await myStreamDeck.fillLcd(barCanvas.toBuffer('raw'), { format: 'rgba' });
            } catch (error) {
                console.error('Error updating Stream Deck LCD:', error.message);
            }
        }
        
        // Function to draw a rounded rectangle
        function roundRect(ctx, x, y, width, height, radius, fillColor) {
            ctx.beginPath();
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + width - radius, y);
            ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
            ctx.lineTo(x + width, y + height - radius);
            ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
            ctx.lineTo(x + radius, y + height);
            ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
            ctx.lineTo(x, y + radius);
            ctx.quadraticCurveTo(x, y, x + radius, y);
            ctx.closePath();
            ctx.fillStyle = fillColor;
            ctx.fill();
        }
        

        myStreamDeck.on('up', async (keyIndex) => {
            try {
                if (keyIndex === 0) {
                    await togglePlayPause();
                } else if (keyIndex === 8) {
                    await togglePrev();
                }else if (keyIndex === 9) {
                    await toggleNext();
                } else if (keyIndex === 2) {
                    const { artist, track } = await getArtistAndTrack();
                    const artworkUrl = await getAlbumArtwork();
                    const playbackInfo = await getCurrentPlaybackInfo();
                    await updateLCDWithMediaInfo(artist, track, artworkUrl, playbackInfo);
                }
            } catch (error) {
                console.error('Error handling Stream Deck key press:', error.message);
            }
        });

        setInterval(async () => {
            try {
                const { artist, track } = await getArtistAndTrack();
                const artworkUrl = await getAlbumArtwork();
                const playbackInfo = await getCurrentPlaybackInfo();
                await updateLCDWithMediaInfo(artist, track, artworkUrl, playbackInfo);
            } catch (error) {
                console.error('Error updating Stream Deck:', error.message);
            }
        }, 1000); // Update every 1 second

    } catch (error) {
        console.error('Error initializing Stream Deck:', error.message);
    }
}

initializeStreamDeck();

app.listen(port, () => {
    console.log(`Express app listening at http://localhost:${port}`);
});