// Game logic of the original Supaplex: a TypeScript port of the reverse-engineered game loop in
// OpenSupaplex (https://github.com/sergiou87/open-supaplex, GPL-3.0, (c) Sergio Padrino), which
// recreates the DOS game's code. Kept close to it on purpose — tile states, timings, random
// numbers and even its quirks must match the original so its demos replay the same.
//
// The level is 60×24 tiles; each tile is (T = tile type, S = state byte). Moving objects
// reserve the tiles they move into with marker values (0x88, 0x99, 0xAA, 0xBB, 0xFF).
// Sprites are drawn into a 944×368 level bitmap as the original does (see draw.ts).
//
// Deterministic: no Date, Math.random or DOM here.

import {
  MURPHY_ANIMATIONS, MURPHY_FRAMES, BUG_FRAMES, ZONK_SLIDE_LEFT_FRAMES, ZONK_SLIDE_RIGHT_FRAMES,
  INFOTRON_SLIDE_LEFT_FRAMES, INFOTRON_SLIDE_RIGHT_FRAMES, REGULAR_EXPLOSION_FRAMES,
  INFOTRON_EXPLOSION_FRAMES, SNIK_SNAK_FRAMES, ELECTRON_FRAMES, type MurphyAnimation,
} from './tables.generated';
import { LEVEL_W, LEVEL_H, type LevelData } from '../data/formats';
import { Tile, Input } from './tiles';
import { drawMovingSpriteFrameInLevel, drawMovingFrame, scrollTerminalScreen, drawFixedLevel, LEVEL_BITMAP_W, LEVEL_BITMAP_H } from './draw';

const kLevelWidth = LEVEL_W;
const kLevelSize = LEVEL_W * LEVEL_H;
const kTileSize = 16;

const u8 = (v: number) => v & 0xff;
const s8 = (v: number) => ((v & 0xff) ^ 0x80) - 0x80;
const u16 = (v: number) => v & 0xffff;
const s16 = (v: number) => ((v & 0xffff) ^ 0x8000) - 0x8000;
/** C integer division (truncates toward zero). */
const idiv = (a: number, b: number) => Math.trunc(a / b);

// Vertical pixel offsets of falling objects (the original stores y*122 screen offsets).
const kFallAnimationGravityOffsets = [0, 122, 244, 366, 488, 610, 732, 854, 976, 1098, 1220, 1342, 1464, 1586, 1708, 1830, 1952, 2074];

/** Sounds the original plays; the front end maps them to audio. */
export type SoundId = 'explosion' | 'infotron' | 'push' | 'fall' | 'bug' | 'base' | 'exit';

// ------------------------------------------------------------------ state

/** Tile types and states of the level. */
// 1536 like the level file: the original copies all of it into the level state.
export const T = new Uint8Array(1536);
export const S = new Uint8Array(1536);
export const gExplosionTimers = new Int8Array(1536);

let gCurrentLevel: LevelData = { tiles: new Uint8Array(0), gravity: 0, name: '', freezeZonks: 0, infotronsNeeded: 0, specialPorts: [], randomSeed: 0, raw: new Uint8Array(1536) };
let gFrameCounter = 0;
let gRandomGeneratorSeed = 0;
let gCurrentUserInput = 0;
let gIsGravityEnabled = 0;
let gAreZonksFrozen = 0;
let gAreEnemiesFrozen = 0;
let gNumberOfRemainingInfotrons = 0;
let gTotalNumberOfInfotrons = 0;
let gNumberOfRemainingRedDisks = 0;
let gPlantedRedDiskCountdown = 0;
let gPlantedRedDiskPosition = 0;
let gTerminalMaxFramesToNextScroll = 0x7f;
let gAreYellowDisksDetonated = 0;
let gIsExplosionStarted = 0;
let gShouldKillMurphy = 0;
let gShouldExitLevel = 0;
let gQuitLevelCountdown = 0;
let gLevelFailed = 1;
let gMurphyLocation = 0;
let gMurphyPreviousLocation = 0;
let gIsMurphyUpdated = 0;
let gMurphyTileX = 0;
let gMurphyTileY = 0;
let gMurphyPositionX = 0;
let gMurphyPositionY = 0;
let gIsMurphyLookingLeft = 0;
let gIsMurphyGoingThroughPortal = 0;
let gMurphyCounterToStartPushAnimation = 0;
let gMurphyYawnAndSleepCounter = 0;
let gPreviousUserInputWasNone = 0;
let gScratchGravity = 0;
let gCurrentMurphyAnimation: MurphyAnimation & { currentFrame: number } = { ...MURPHY_ANIMATIONS[0]!, currentFrame: 0 };

let sounds: SoundId[] = [];
const playExplosionSound = () => sounds.push('explosion');
const playInfotronSound = () => sounds.push('infotron');
const playPushSound = () => sounds.push('push');
const playFallSound = () => sounds.push('fall');
const playBugSound = () => sounds.push('bug');
const playBaseSound = () => sounds.push('base');
const playExitSound = () => sounds.push('exit');
// The panel is drawn from the state each frame.
const drawNumberOfRemainingInfotrons = () => {};
/** Frames the red disk count stays on the panel (original: gAdditionalInfoInGamePanelFrameCounter). */
let gAdditionalInfoInGamePanelFrameCounter = 0;
const drawNumberOfRemainingRedDisks = () => {
    gAdditionalInfoInGamePanelFrameCounter = 0x46;
};

function generateRandomNumber(): number {
  gRandomGeneratorSeed = u16(gRandomGeneratorSeed * 0x5e5 + 0x31);
  return gRandomGeneratorSeed >> 1;
}

function updateZonkTiles(position: number): void
{
    let currentTile = position;
    let belowTile = position + kLevelWidth;
    let belowLeftTile = position + kLevelWidth - 1;
    let leftTile = position - 1;
    let belowRightTile = position + kLevelWidth + 1;
    let rightTile = position + 1;
    let aboveRightTile = position - kLevelWidth + 1;
    if (T[currentTile] != Tile.Zonk)
    {
        return;
    }
    let shouldSkipFirstPartOfLoop = u8(0);
    if (T[currentTile] != Tile.Zonk || S[currentTile] != 0)
    {
        shouldSkipFirstPartOfLoop = u8(1);
    }
    else
    {
        if (gAreZonksFrozen == 2)
        {
            return;
        }
        if (T[belowTile] == Tile.Space && S[belowTile] == 0)
        {
            S[currentTile] = 0x40;
            shouldSkipFirstPartOfLoop = u8(1);
        }
        else
        {
            if (S[belowTile] != 0 || (T[belowTile] != Tile.Zonk && T[belowTile] != Tile.Infotron && T[belowTile] != Tile.Chip))
            {
                return;
            }
            if ((T[belowLeftTile] == Tile.Space && S[belowLeftTile] == 0) || (T[belowLeftTile] == 0x88 && S[belowLeftTile] == 0x88) || (T[belowLeftTile] == 0xAA && S[belowLeftTile] == 0xAA))
            {
                if (S[leftTile] == 0 && T[leftTile] == Tile.Space)
                {
                    S[currentTile] = 0x50;
                    S[leftTile] = 0x88;
                    T[leftTile] = 0x88;
                    shouldSkipFirstPartOfLoop = u8(1);
                }
            }
        }
    }
    let shouldSkipTo_loc_481C6 = u8(0);
    do
    {
        if (shouldSkipFirstPartOfLoop == 0)
        {
            if ((S[belowRightTile] != 0 || T[belowRightTile] != Tile.Space) && (S[belowRightTile] != 0x88 || T[belowRightTile] != 0x88) && (S[belowRightTile] != 0xAA || T[belowRightTile] != 0xAA))
            {
                return;
            }
            else
            {
                if ((S[rightTile] != 0 || T[rightTile] != Tile.Space) && ((S[rightTile] != 0x99 || T[rightTile] != 0x99) || T[aboveRightTile] != Tile.Zonk))
                {
                    return;
                }
                S[currentTile] = 0x60;
                S[rightTile] = 0x88;
                T[rightTile] = 0x88;
            }
        }
        shouldSkipFirstPartOfLoop = u8(0);
        let state = u8(S[currentTile]);
        let stateType = u8(state & 0xF0);
        if (stateType != 0x10)
        {
            if (stateType == 0x20)
            {
                let stateFrame = u8(state & 0x7);
                let tileX = u8((position % kLevelWidth));
                let tileY = u8((idiv(position, kLevelWidth)));
                let dstX = u16(tileX * kTileSize);
                let dstY = u16(tileY * kTileSize);
                let frameCoordinates = ZONK_SLIDE_LEFT_FRAMES[stateFrame];
                drawMovingSpriteFrameInLevel(frameCoordinates[0],
                                             frameCoordinates[1],
                                             kTileSize * 2,
                                             kTileSize,
                                             dstX, dstY);
                state = u8(S[currentTile]);
                state = u8(state + 1);
                if (state == 0x24)
                {
                    S[rightTile] = 0xAA;
                    T[rightTile] = 0xAA;
                }
                if (state == 0x26)
                {
                    S[currentTile] = state;
                    handleZonkStateAfterFallingOneTile(position + 1);
                    return;
                }
                else if (state < 0x28)
                {
                    S[currentTile] = state;
                    return;
                }
                else
                {
                    S[currentTile] = 0xFF;
                    T[currentTile] = 0xFF;
                    S[belowTile] = 0x10;
                    T[belowTile] = Tile.Zonk;
                    return;
                }
            }
            else if (stateType == 0x30)
            {
                let stateFrame = u8(state & 0x7);
                let tileX = u8(((position - 1) % kLevelWidth));
                let tileY = u8(idiv(position - 1, kLevelWidth));
                let dstX = u16(tileX * kTileSize);
                let dstY = u16(tileY * kTileSize);
                let frameCoordinates = ZONK_SLIDE_RIGHT_FRAMES[stateFrame];
                drawMovingSpriteFrameInLevel(frameCoordinates[0],
                                             frameCoordinates[1],
                                             kTileSize * 2,
                                             kTileSize,
                                             dstX, dstY);
                state = u8(S[currentTile]);
                state = u8(state + 1);
                if (state == 0x34)
                {
                    S[leftTile] = 0xAA;
                    T[leftTile] = 0xAA;
                }
                if (state == 0x36)
                {
                    S[currentTile] = state;
                    handleZonkStateAfterFallingOneTile(position - 1);
                    return;
                }
                else if (state < 0x38)
                {
                    S[currentTile] = state;
                    return;
                }
                else
                {
                    S[currentTile] = 0xFF;
                    T[currentTile] = 0xFF;
                    S[belowTile] = 0x10;
                    T[belowTile] = Tile.Zonk;
                    return;
                }
            }
            else if (gAreZonksFrozen == 2)
            {
                return;
            }
            else if (stateType == 0x40)
            {
                state = u8(state + 1);
                if (state < 0x42)
                {
                    S[currentTile] = state;
                    return;
                }
                else if (T[belowTile] != Tile.Space || S[belowTile] != 0)
                {
                    state = u8(state - 1);
                    S[currentTile] = state;
                    return;
                }
                else
                {
                    S[currentTile] = 0xFF;
                    T[currentTile] = 0xFF;
                    S[belowTile] = 0x10;
                    T[belowTile] = Tile.Zonk;
                    return;
                }
            }
            else if (stateType == 0x50)
            {
                let stateFrame = u8(state & 0x7);
                let tileX = u8(((position - 1) % kLevelWidth));
                let tileY = u8(idiv(position - 1, kLevelWidth));
                let dstX = u16(tileX * kTileSize);
                let dstY = u16(tileY * kTileSize);
                let frameCoordinates = ZONK_SLIDE_LEFT_FRAMES[stateFrame];
                drawMovingSpriteFrameInLevel(frameCoordinates[0],
                                             frameCoordinates[1],
                                             kTileSize * 2,
                                             kTileSize,
                                             dstX, dstY);
                state = u8(S[currentTile]);
                state = u8(state + 1);
                if (state < 0x52)
                {
                    S[currentTile] = state;
                    return;
                }
                else if (S[belowLeftTile] != 0 || T[belowLeftTile] != Tile.Space)
                {
                    state = u8(state - 1);
                    S[currentTile] = state;
                    return;
                }
                else if ((S[leftTile] != 0 || T[leftTile] != Tile.Space)
                         && (S[leftTile] != 0x88 || T[leftTile] != 0x88))
                {
                    state = u8(state - 1);
                    S[currentTile] = state;
                    return;
                }
                else
                {
                    S[currentTile] = 0xFF;
                    T[currentTile] = 0xFF;
                    S[leftTile] = 0x22;
                    T[leftTile] = Tile.Zonk;
                    S[belowLeftTile] = 0xFF;
                    T[belowLeftTile] = 0xFF;
                    return;
                }
            }
            else if (stateType == 0x60)
            {
                let stateFrame = u8(state & 0x7);
                let tileX = u8((position % kLevelWidth));
                let tileY = u8((idiv(position, kLevelWidth)));
                let dstX = u16(tileX * kTileSize);
                let dstY = u16(tileY * kTileSize);
                let frameCoordinates = ZONK_SLIDE_RIGHT_FRAMES[stateFrame];
                drawMovingSpriteFrameInLevel(frameCoordinates[0],
                                             frameCoordinates[1],
                                             kTileSize * 2,
                                             kTileSize,
                                             dstX, dstY);
                state = u8(S[currentTile]);
                state = u8(state + 1);
                if (state < 0x62)
                {
                    S[currentTile] = state;
                    return;
                }
                else if (S[belowRightTile] != 0 || T[belowRightTile] != Tile.Space)
                {
                    state = u8(state - 1);
                    S[currentTile] = state;
                    return;
                }
                else if ((S[rightTile] != 0 || T[rightTile] != Tile.Space)
                         && (S[rightTile] != 0x88 || T[rightTile] != 0x88))
                {
                    state = u8(state - 1);
                    S[currentTile] = state;
                    return;
                }
                else
                {
                    S[currentTile] = 0xFF;
                    T[currentTile] = 0xFF;
                    S[rightTile] = 0x32;
                    T[rightTile] = Tile.Zonk;
                    S[belowRightTile] = 0xFF;
                    T[belowRightTile] = 0xFF;
                    return;
                }
            }
            else if (stateType == 0x70)
            {
                if ((S[belowTile] != 0 || T[belowTile] != Tile.Space)
                    && (S[belowTile] != 0x99 && T[belowTile] != 0x99))
                {
                    return;
                }
                S[currentTile] = 0xFF;
                T[currentTile] = 0xFF;
                position = s16(position + (kLevelWidth));
                currentTile = position;
                belowTile = position + kLevelWidth;
                belowLeftTile = position + kLevelWidth - 1;
                leftTile = position - 1;
                belowRightTile = position + kLevelWidth + 1;
                rightTile = position + 1;
                aboveRightTile = position - kLevelWidth + 1;
                S[currentTile] = 0x10;
                T[currentTile] = Tile.Zonk;
            }
            else
            {
                return;
            }
        }
        let somePositionThing = u8(state);
        somePositionThing = u8(somePositionThing * (2));
        somePositionThing = u8(somePositionThing & (0x1F));
        let offset = u16(kFallAnimationGravityOffsets[somePositionThing]);
        let finalPosition = u16(position - kLevelWidth);
        let tileX = u8((finalPosition % kLevelWidth));
        let tileY = u8((idiv(finalPosition, kLevelWidth)));
        let dstX = u16(tileX * kTileSize + (offset % 122));
        let dstY = u16(tileY * kTileSize + (idiv(offset, 122)));
        drawMovingSpriteFrameInLevel(224, 82,
                                     kTileSize,
                                     kTileSize + 2,
                                     dstX, dstY);
        let newState = u8(S[currentTile]);
        newState = u8(newState + 1);
        if (newState == 0x16)
        {
            S[currentTile] = newState;
            handleZonkStateAfterFallingOneTile(position - kLevelWidth);
            return;
        }
        else if (newState < 0x18)
        {
            S[currentTile] = newState;
            return;
        }
        S[currentTile] = 0;
        if (gAreZonksFrozen == 2)
        {
            return;
        }
        if ((T[belowTile] == Tile.Space && S[belowTile] == 0)
            || (T[belowTile] == 0x99 && S[belowTile] == 0x99))
        {
            S[currentTile] = 0x70;
            T[currentTile] = Tile.Zonk;
            S[belowTile] = 0x99;
            T[belowTile] = 0x99;
            return;
        }
        if (T[belowTile] == Tile.Murphy)
        {
            break;
        }
        if (T[belowTile] == Tile.SnikSnak)
        {
            detonateBigExplosion(position + kLevelWidth);
            return;
        }
        if (T[belowTile] == 0xBB && S[belowTile] == 0x2)
        {
            shouldSkipTo_loc_481C6 = u8(1);
            break;
        }
        if (T[belowTile] == 0xBB && S[belowTile] == 0x4)
        {
            if (T[belowRightTile] == Tile.Electron)
            {
                T[belowTile] = Tile.Electron;
                S[belowTile] = 0;
            }
            if (T[belowRightTile] != Tile.Explosion)
            {
                T[belowRightTile] = Tile.Space;
                S[belowRightTile] = 0;
            }
            detonateBigExplosion(position + kLevelWidth);
            return;
        }
        if (T[belowTile] == Tile.Electron)
        {
            detonateBigExplosion(position + kLevelWidth);
            return;
        }
        if (T[belowTile] == Tile.OrangeDisk && S[belowTile] == 0)
        {
            gExplosionTimers[position + kLevelWidth] = 6;
            return;
        }
        playFallSound();
        if ((T[belowTile] != Tile.Zonk || S[belowTile] != 0)
            && (T[belowTile] != Tile.Infotron || S[belowTile] != 0)
            && (T[belowTile] != Tile.Chip || S[belowTile] != 0))
        {
            return;
        }
        if ((S[belowLeftTile] == 0 && T[belowLeftTile] == Tile.Space)
            || (S[belowLeftTile] == 0x88 && T[belowLeftTile] == 0x88)
            || (S[belowLeftTile] == 0xAA && T[belowLeftTile] == 0xAA))
        {
            if (S[leftTile] == 0 && T[leftTile] == Tile.Space)
            {
                S[currentTile] = 0x50;
                S[leftTile] = 0x88;
                T[leftTile] = 0x88;
                return;
            }
            else
            {
                continue;
            }
        }
        if ((S[belowRightTile] == 0 && T[belowRightTile] == Tile.Space)
            || (S[belowRightTile] == 0x88 && T[belowRightTile] == 0x88)
            || (S[belowRightTile] == 0xAA && T[belowRightTile] == 0xAA))
        {
            if (T[rightTile] == Tile.Space && S[rightTile] == 0)
            {
                S[currentTile] = 0x60;
                S[rightTile] = 0x88;
                T[rightTile] = 0x88;
                return;
            }
            else
            {
                return;
            }
        }
        return;
    } while (1);
    if (shouldSkipTo_loc_481C6 == 0)
    {
        if (S[belowTile] == 0xE || S[belowTile] == 0xF || S[belowTile] == 0x28 || S[belowTile] == 0x29 || S[belowTile] == 0x25 || S[belowTile] == 0x26)
        {
            return;
        }
    }
    if (T[belowLeftTile] == Tile.Electron)
    {
        T[belowTile] = Tile.Electron;
        S[belowTile] = 0;
    }
    if (T[belowLeftTile] != Tile.Explosion)
    {
        T[belowLeftTile] = Tile.Space;
        S[belowLeftTile] = 0;
    }
    detonateBigExplosion(position + kLevelWidth);
}
function updateInfotronTiles(position: number): void
{
    let currentTile = position;
    let belowTile = position + kLevelWidth;
    let belowLeftTile = position + kLevelWidth - 1;
    let belowRightTile = position + kLevelWidth + 1;
    let leftTile = position - 1;
    let rightTile = position + 1;
    if (T[currentTile] != Tile.Infotron)
    {
        return;
    }
    let shouldSkipFirstPartOfLoop = u8(0);
    if (S[currentTile] != 0 || T[currentTile] != Tile.Infotron)
    {
        shouldSkipFirstPartOfLoop = u8(1);
    }
    else
    {
        if (S[belowTile] == 0 && T[belowTile] == Tile.Space)
        {
            S[currentTile] = 0x40;
            shouldSkipFirstPartOfLoop = u8(1);
        }
        else
        {
            if ((S[belowTile] != 0 || T[belowTile] != Tile.Zonk) && (S[belowTile] != 0 || T[belowTile] != Tile.Infotron) && (S[belowTile] != 0 || T[belowTile] != Tile.Chip))
            {
                return;
            }
            if ((S[belowLeftTile] == 0 && T[belowLeftTile] == Tile.Space) || (S[belowLeftTile] == 0x88 && T[belowLeftTile] == 0x88) || (S[belowLeftTile] == 0xAA && T[belowLeftTile] == 0xAA))
            {
                if (S[leftTile] == 0 && T[leftTile] == Tile.Space)
                {
                    S[currentTile] = 0x50;
                    S[leftTile] = 0x88;
                    T[leftTile] = 0x88;
                    shouldSkipFirstPartOfLoop = u8(1);
                }
            }
        }
    }
    do
    {
        if (shouldSkipFirstPartOfLoop == 0)
        {
            if ((S[belowRightTile] != 0 || T[belowRightTile] != Tile.Space) && (S[belowRightTile] != 0x88 || T[belowRightTile] != 0x88) && (S[belowRightTile] != 0xAA || T[belowRightTile] != 0xAA))
            {
                return;
            }
            if (S[rightTile] != 0 || T[rightTile] != Tile.Space)
            {
                return;
            }
            S[currentTile] = 0x60;
            S[rightTile] = 0x88;
            T[rightTile] = 0x88;
        }
        shouldSkipFirstPartOfLoop = u8(0);
        let state = u8(S[currentTile]);
        let stateType = u8(state & 0xF0);
        if (stateType != 0x10)
        {
            if (stateType == 0x20)
            {
                let stateFrame = u8(state & 0x7);
                let frameCoordinates = INFOTRON_SLIDE_LEFT_FRAMES[stateFrame];
                let tileX = u8((position % kLevelWidth));
                let tileY = u8((idiv(position, kLevelWidth)));
                let dstX = u16(tileX * kTileSize);
                let dstY = u16(tileY * kTileSize);
                drawMovingSpriteFrameInLevel(frameCoordinates[0],
                                             frameCoordinates[1],
                                             kTileSize * 2,
                                             kTileSize,
                                             dstX,
                                             dstY);
                state = u8(S[currentTile]);
                state = u8(state + 1);
                if (state == 0x24)
                {
                    S[rightTile] = 0xAA;
                    T[rightTile] = 0xAA;
                }
                if (state == 0x26)
                {
                    S[currentTile] = state;
                    handleInfotronStateAfterFallingOneTile(position + 1);
                    return;
                }
                else if (state < 0x28)
                {
                    S[currentTile] = state;
                    return;
                }
                else
                {
                    S[currentTile] = 0x70;
                    T[currentTile] = Tile.Infotron;
                    return;
                }
            }
            else if (stateType == 0x30)
            {
                let stateFrame = u8(state & 0x7);
                let tileX = u8(((position - 1) % kLevelWidth));
                let tileY = u8(idiv(position - 1, kLevelWidth));
                let dstX = u16(tileX * kTileSize);
                let dstY = u16(tileY * kTileSize);
                let frameCoordinates = INFOTRON_SLIDE_RIGHT_FRAMES[stateFrame];
                drawMovingSpriteFrameInLevel(frameCoordinates[0],
                                             frameCoordinates[1],
                                             kTileSize * 2,
                                             kTileSize,
                                             dstX, dstY);
                state = u8(S[currentTile]);
                state = u8(state + 1);
                if (state == 0x34)
                {
                    S[leftTile] = 0xAA;
                    T[leftTile] = 0xAA;
                }
                if (state == 0x36)
                {
                    S[currentTile] = state;
                    handleInfotronStateAfterFallingOneTile(position - 1);
                }
                if (state < 0x38)
                {
                    S[currentTile] = state;
                    return;
                }
                else
                {
                    S[currentTile] = 0x70;
                    T[currentTile] = Tile.Infotron;
                    return;
                }
            }
            else if (stateType == 0x40)
            {
                state = u8(state + 1);
                if (state < 0x42)
                {
                    S[currentTile] = state;
                    return;
                }
                if (S[belowTile] != 0 || T[belowTile] != Tile.Space)
                {
                    state = u8(state - 1);
                    S[currentTile] = state;
                    return;
                }
                S[currentTile] = 0xFF;
                T[currentTile] = 0xFF;
                S[belowTile] = 0x10;
                T[belowTile] = Tile.Infotron;
                return;
            }
            else if (stateType == 0x50)
            {
                let stateFrame = u8(state & 0x7);
                let tileX = u8(((position - 1) % kLevelWidth));
                let tileY = u8(idiv(position - 1, kLevelWidth));
                let dstX = u16(tileX * kTileSize);
                let dstY = u16(tileY * kTileSize);
                let frameCoordinates = INFOTRON_SLIDE_LEFT_FRAMES[stateFrame];
                drawMovingSpriteFrameInLevel(frameCoordinates[0],
                                             frameCoordinates[1],
                                             kTileSize * 2,
                                             kTileSize,
                                             dstX, dstY);
                state = u8(S[currentTile]);
                state = u8(state + 1);
                if (state < 0x52)
                {
                    S[currentTile] = state;
                    return;
                }
                else if (S[belowLeftTile] != 0 || T[belowLeftTile] != Tile.Space)
                {
                    state = u8(state - 1);
                    S[currentTile] = state;
                    return;
                }
                else if ((S[leftTile] != 0 || T[leftTile] != Tile.Space)
                         && (S[leftTile] != 0x88 || T[leftTile] != 0x88))
                {
                    state = u8(state - 1);
                    S[currentTile] = state;
                    return;
                }
                else
                {
                    S[currentTile] = 0xFF;
                    T[currentTile] = 0xFF;
                    S[leftTile] = 0x22;
                    T[leftTile] = Tile.Infotron;
                    S[belowLeftTile] = 0x99;
                    T[belowLeftTile] = 0x99;
                    return;
                }
            }
            else if (stateType == 0x60)
            {
                let stateFrame = u8(state & 0x7);
                let tileX = u8((position % kLevelWidth));
                let tileY = u8((idiv(position, kLevelWidth)));
                let dstX = u16(tileX * kTileSize);
                let dstY = u16(tileY * kTileSize);
                let frameCoordinates = INFOTRON_SLIDE_RIGHT_FRAMES[stateFrame];
                drawMovingSpriteFrameInLevel(frameCoordinates[0],
                                             frameCoordinates[1],
                                             kTileSize * 2,
                                             kTileSize,
                                             dstX, dstY);
                state = u8(S[currentTile]);
                state = u8(state + 1);
                if (state < 0x62)
                {
                    S[currentTile] = state;
                    return;
                }
                else if (S[belowRightTile] != 0 || T[belowRightTile] != Tile.Space)
                {
                    state = u8(state - 1);
                    S[currentTile] = state;
                    return;
                }
                else if ((S[rightTile] != 0 || T[rightTile] != Tile.Space)
                         && (S[rightTile] != 0x88 || T[rightTile] != 0x88))
                {
                    state = u8(state - 1);
                    S[currentTile] = state;
                    return;
                }
                else
                {
                    S[currentTile] = 0xFF;
                    T[currentTile] = 0xFF;
                    S[rightTile] = 0x32;
                    T[rightTile] = Tile.Infotron;
                    S[belowRightTile] = 0x99;
                    T[belowRightTile] = 0x99;
                    return;
                }
            }
            else if (stateType == 0x70)
            {
                if ((S[belowTile] != 0 || T[belowTile] != Tile.Space) && (S[belowTile] != 0x99 || T[belowTile] != 0x99))
                {
                    return;
                }
                S[currentTile] = 0xFF;
                T[currentTile] = 0xFF;
                position = s16(position + (kLevelWidth));
                currentTile = position;
                belowTile = position + kLevelWidth;
                belowLeftTile = position + kLevelWidth - 1;
                leftTile = position - 1;
                belowRightTile = position + kLevelWidth + 1;
                rightTile = position + 1;
                S[currentTile] = 0x10;
                T[currentTile] = Tile.Infotron;
            }
            else
            {
                return;
            }
        }
        let somePositionThing = u8(state);
        somePositionThing = u8(somePositionThing * (2));
        somePositionThing = u8(somePositionThing & (0x1F));
        let offset = u16(kFallAnimationGravityOffsets[somePositionThing]);
        let finalPosition = u16(position - kLevelWidth);
        let tileX = u8((finalPosition % kLevelWidth));
        let tileY = u8((idiv(finalPosition, kLevelWidth)));
        let dstX = u16(tileX * kTileSize + (offset % 122));
        let dstY = u16(tileY * kTileSize + (idiv(offset, 122)));
        drawMovingSpriteFrameInLevel(240, 178,
                                     kTileSize,
                                     kTileSize + 2,
                                     dstX, dstY);
        let newState = u8(S[currentTile]);
        newState = u8(newState + 1);
        if (newState == 0x16)
        {
            S[currentTile] = newState;
            handleInfotronStateAfterFallingOneTile(position - kLevelWidth);
            return;
        }
        else if (newState < 0x18)
        {
            S[currentTile] = newState;
            return;
        }
        S[currentTile] = 0;
        if ((T[belowTile] == Tile.Space && S[belowTile] == 0)
            || (T[belowTile] == 0x99 && S[belowTile] == 0x99))
        {
            S[currentTile] = 0x70;
            T[currentTile] = Tile.Infotron;
            S[belowTile] = 0x99;
            T[belowTile] = 0x99;
            return;
        }
        if (T[belowTile] == Tile.Murphy)
        {
            if (S[belowTile] == 0xE || S[belowTile] == 0xF || S[belowTile] == 0x28 || S[belowTile] == 0x29 || S[belowTile] == 0x25 || S[belowTile] == 0x26)
            {
                return;
            }
            detonateBigExplosion(position + kLevelWidth);
            return;
        }
        if ((T[belowTile] == Tile.RedDisk && S[belowTile] == 0)
            || T[belowTile] == Tile.SnikSnak
            || T[belowTile] == Tile.Electron
            || (T[belowTile] == Tile.YellowDisk && S[belowTile] == 0)
            || (T[belowTile] == Tile.OrangeDisk && S[belowTile] == 0))
        {
            detonateBigExplosion(position + kLevelWidth);
            return;
        }
        playFallSound();
        if ((T[belowTile] != Tile.Zonk || S[belowTile] != 0)
            && (T[belowTile] != Tile.Infotron || S[belowTile] != 0)
            && (T[belowTile] != Tile.Chip || S[belowTile] != 0))
        {
            return;
        }
        if ((T[belowLeftTile] == Tile.Space && S[belowLeftTile] == 0)
            || (T[belowLeftTile] == 0x88 && S[belowLeftTile] == 0x88)
            || (T[belowLeftTile] == 0xAA && S[belowLeftTile] == 0xAA))
        {
            if (S[leftTile] == 0 && T[leftTile] == Tile.Space)
            {
                S[currentTile] = 0x50;
                S[leftTile] = 0x88;
                T[leftTile] = 0x88;
                return;
            }
            else
            {
                continue;
            }
        }
        if ((T[belowRightTile] == Tile.Space && S[belowRightTile] == 0)
            || (T[belowRightTile] == 0x88 && S[belowRightTile] == 0x88)
            || (T[belowRightTile] == 0xAA && S[belowRightTile] == 0xAA))
        {
            if (S[rightTile] == 0 && T[rightTile] == Tile.Space)
            {
                S[currentTile] = 0x60;
                S[rightTile] = 0x88;
                T[rightTile] = 0x88;
                return;
            }
            return;
        }
        return;
    } while (1);
}
function handleMurphyCollisionAfterMovement(position: number): void
{
    let currentTile = position;
    let aboveTile = position - kLevelWidth;
    let leftTile = position - 1;
    let rightTile = position + 1;
    let aboveRightTile = position - kLevelWidth + 1;
    let aboveLeftTile = position - kLevelWidth - 1;
    if (T[currentTile] != Tile.Explosion)
    {
        S[currentTile] = 0;
        T[currentTile] = Tile.Space;
    }
    if ((S[aboveTile] == 0 && T[aboveTile] == Tile.Space) || (S[aboveTile] == 0x99 && T[aboveTile] == 0x99))
    {
        if (S[aboveLeftTile] == 0 && T[aboveLeftTile] == Tile.Zonk)
        {
            if ((S[leftTile] == 0 && T[leftTile] == Tile.Zonk) || (S[leftTile] == 0 && T[leftTile] == Tile.Infotron) || (S[leftTile] == 0 && T[leftTile] == Tile.Chip))
            {
                S[aboveLeftTile] = 0x60;
                S[aboveTile] = 0x88;
                T[aboveTile] = 0x88;
                return;
            }
        }
        else if (S[aboveLeftTile] == 0 && T[aboveLeftTile] == Tile.Infotron)
        {
            if ((S[leftTile] == 0 && T[leftTile] == Tile.Zonk) || (S[leftTile] == 0 && T[leftTile] == Tile.Infotron) || (S[leftTile] == 0 && T[leftTile] == Tile.Chip))
            {
                S[aboveLeftTile] = 0x60;
                S[aboveTile] = 0x88;
                T[aboveTile] = 0x88;
                return;
            }
        }
        if (S[aboveRightTile] == 0 && T[aboveRightTile] == Tile.Zonk)
        {
            if ((S[rightTile] == 0 && T[rightTile] == Tile.Zonk) || (S[rightTile] == 0 && T[rightTile] == Tile.Infotron) || (S[rightTile] == 0 && T[rightTile] == Tile.Chip))
            {
                S[aboveRightTile] = 0x50;
                S[aboveTile] = 0x88;
                T[aboveTile] = 0x88;
            }
        }
        else if (S[aboveRightTile] == 0 && T[aboveRightTile] == Tile.Infotron)
        {
            if ((S[rightTile] == 0 && T[rightTile] == Tile.Zonk) || (S[rightTile] == 0 && T[rightTile] == Tile.Infotron) || (S[rightTile] == 0 && T[rightTile] == Tile.Chip))
            {
                S[aboveRightTile] = 0x50;
                S[aboveTile] = 0x88;
                T[aboveTile] = 0x88;
            }
        }
    }
    else if (S[aboveTile] == 0 && T[aboveTile] == Tile.Zonk)
    {
        S[aboveTile] = 0x40;
    }
    else if (S[aboveTile] == 0 && T[aboveTile] == Tile.Infotron)
    {
        S[aboveTile] = 0x40;
    }
}
function handleZonkStateAfterFallingOneTile(position: number): void
{
    let currentTile = position;
    let aboveTile = position - kLevelWidth;
    let leftTile = position - 1;
    let rightTile = position + 1;
    let aboveAboveTile = position - kLevelWidth * 2;
    let aboveLeftTile = position - kLevelWidth - 1;
    let aboveRightTile = position - kLevelWidth + 1;
    if (T[currentTile] != Tile.Explosion)
    {
        S[currentTile] = 0;
        T[currentTile] = Tile.Space;
    }
    if (S[aboveTile] != 0 || T[aboveTile] != Tile.Space)
    {
        if (S[aboveTile] != 0x99 || T[aboveTile] != 0x99)
        {
            return;
        }
        if (T[aboveAboveTile] != Tile.Infotron)
        {
            return;
        }
    }
    if (S[aboveLeftTile] == 0 && T[aboveLeftTile] == Tile.Zonk)
    {
        if (S[leftTile] == 0 && (T[leftTile] == Tile.Zonk || T[leftTile] == Tile.Infotron || T[leftTile] == Tile.Chip))
        {
            S[aboveLeftTile] = 0x60;
            T[aboveLeftTile] = Tile.Zonk;
            S[aboveTile] = 0x88;
            T[aboveTile] = 0x88;
            return;
        }
    }
    if (S[aboveRightTile] == 0 && T[aboveRightTile] == Tile.Zonk)
    {
        if (S[rightTile] != 0 || (T[rightTile] != Tile.Zonk && T[rightTile] != Tile.Infotron && T[rightTile] != Tile.Chip))
        {
            return;
        }
        S[aboveRightTile] = 0x50;
        T[aboveRightTile] = Tile.Zonk;
        S[aboveTile] = 0x88;
        T[aboveTile] = 0x88;
        return;
    }
}
function handleInfotronStateAfterFallingOneTile(position: number): void
{
    let currentTile = position;
    let aboveTile = position - kLevelWidth;
    let aboveAboveTile = position - kLevelWidth * 2;
    let aboveLeftTile = position - kLevelWidth - 1;
    let aboveRightTile = position - kLevelWidth + 1;
    let leftTile = position - 1;
    let rightTile = position + 1;
    if (T[currentTile] != Tile.Explosion)
    {
        S[currentTile] = 0;
        T[currentTile] = Tile.Space;
    }
    if (S[aboveTile] != 0 || T[aboveTile] != Tile.Space)
    {
        if (S[aboveTile] == 0x99 && T[aboveTile] == 0x99)
        {
            if (T[aboveAboveTile] != Tile.Zonk)
            {
                return;
            }
        }
        else
        {
            return;
        }
    }
    if (S[aboveLeftTile] == 0 && T[aboveLeftTile] == Tile.Infotron)
    {
        if ((S[leftTile] == 0 && T[leftTile] == Tile.Zonk) || (S[leftTile] == 0 && T[leftTile] == Tile.Infotron) || (S[leftTile] == 0 && T[leftTile] == Tile.Chip))
        {
            S[aboveLeftTile] = 0x60;
            T[aboveLeftTile] = Tile.Infotron;
            S[aboveTile] = 0x88;
            T[aboveTile] = 0x88;
            return;
        }
    }
    if (S[aboveRightTile] != 0 || T[aboveRightTile] != Tile.Infotron)
    {
        return;
    }
    if ((S[rightTile] != 0 || T[rightTile] != Tile.Zonk) && (S[rightTile] != 0 || T[rightTile] != Tile.Infotron) && (S[rightTile] != 0 || T[rightTile] != Tile.Chip))
    {
        return;
    }
    S[aboveRightTile] = 0x50;
    T[aboveRightTile] = Tile.Infotron;
    S[aboveTile] = 0x88;
    T[aboveTile] = 0x88;
}
function updateMovingObjects(): void
{
    gMurphyLocation = updateMurphy(gMurphyLocation);
    // The list of moving objects is collected first, then each is updated (the inner area only).
    const functions: ((position: number) => void)[] = [];
    const positions: number[] = [];
    for (let i = kLevelWidth + 1; i < kLevelSize - kLevelWidth - 1; ++i)
    {
        let tile = T[i]!;
        if ((tile & Tile.SportRight) == 0 || tile >= 0x20)
        {
            continue;
        }
        let fn = movingFunctions[tile];
        if (fn)
        {
            functions.push(fn);
            positions.push(i);
        }
    }
    for (let i = 0; i < functions.length; ++i)
    {
        functions[i]!(positions[i]!);
    }
    if (gShouldKillMurphy != 1 && gIsMurphyUpdated != 0)
    {
        return;
    }
    if (gQuitLevelCountdown == 0)
    {
        gShouldKillMurphy = 0;
        detonateBigExplosion(gMurphyPreviousLocation);
        gQuitLevelCountdown = u16(0x40);
    }
    return;
}
function updateBugTiles(position: number): void
{
    let currentTile = position;
    let aboveTile = position - kLevelWidth;
    let belowTile = position + kLevelWidth;
    let leftTile = position - 1;
    let rightTile = position + 1;
    let aboveLeftTile = position - kLevelWidth - 1;
    let aboveRightTile = position - kLevelWidth + 1;
    let belowLeftTile = position + kLevelWidth - 1;
    let belowRightTile = position + kLevelWidth + 1;
    if (T[currentTile] != Tile.Bug)
    {
        return;
    }
    if ((gFrameCounter & 3) != 0)
    {
        return;
    }
    let frameNumber = s8(S[currentTile]);
    frameNumber = s8(frameNumber + 1);
    if (frameNumber >= 0xE)
    {
        let value = u8(generateRandomNumber() & 0xFF);
        value = u8(value & (0x3F));
        value = u8(value + (0x20));
        value = u8(-value);
        frameNumber = s8(value);
    }
    S[currentTile] = frameNumber;
    if (frameNumber < 0)
    {
        return;
    }
    if (T[aboveLeftTile] == Tile.Murphy || T[aboveTile] == Tile.Murphy || T[aboveRightTile] == Tile.Murphy || T[leftTile] == Tile.Murphy || T[rightTile] == Tile.Murphy || T[belowLeftTile] == Tile.Murphy || T[belowTile] == Tile.Murphy || T[belowRightTile] == Tile.Murphy)
    {
        playBugSound();
    }
    let frameCoordinates = BUG_FRAMES[frameNumber];
    drawMovingFrame(frameCoordinates[0], frameCoordinates[1], position);
}
function updateTerminalTiles(position: number): void
{
    let currentTile = position;
    if (T[currentTile] != Tile.Terminal)
    {
        return;
    }
    let state = s8(S[currentTile]);
    state = s8(state + 1);
    if (state <= 0)
    {
        S[currentTile] = state;
        return;
    }
    let value = u8(generateRandomNumber() & 0xFF);
    value = u8(value & (gTerminalMaxFramesToNextScroll));
    value = u8(-value);
    S[currentTile] = value;
    scrollTerminalScreen(position);
}
function updateOrangeDiskTiles(position: number): void
{
    let currentTile = position;
    let belowTile = position + kLevelWidth;
    if (T[currentTile] != Tile.OrangeDisk)
    {
        return;
    }
    let tileValue = u16(((S[currentTile] << 8) | T[currentTile]));
    if (tileValue >= 0x3008)
    {
        let stateFrame = u8(S[currentTile]);
        stateFrame = u8(stateFrame * (2));
        stateFrame = u8(stateFrame & (0xF));
        let offset = u16(kFallAnimationGravityOffsets[stateFrame]);
        let tileX = u8((position % kLevelWidth));
        let tileY = u8((idiv(position, kLevelWidth)));
        let dstX = u16(tileX * kTileSize + (offset % 122));
        let dstY = u16(tileY * kTileSize + (idiv(offset, 122)));
        drawMovingSpriteFrameInLevel(128, 64,
                                     kTileSize,
                                     kTileSize + 2,
                                     dstX, dstY);
        let state = u8(S[currentTile]);
        state = u8(state + 1);
        let otherMovingObject = u8(state);
        otherMovingObject = u8(otherMovingObject & (7));
        if (otherMovingObject != 0)
        {
            S[currentTile] = state;
            return;
        }
        S[currentTile] = 0;
        T[currentTile] = Tile.Space;
        S[belowTile] = 0;
        T[belowTile] = Tile.OrangeDisk;
        position = s16(position + (kLevelWidth));
        currentTile = position;
        belowTile = position + kLevelWidth;
        if (S[belowTile] == 0 && T[belowTile] == Tile.Space)
        {
            S[currentTile] = 0x30;
            S[belowTile] = 8;
        }
        else if (T[belowTile] != Tile.Explosion)
        {
            detonateBigExplosion(position);
        }
        return;
    }
    else if (tileValue >= 0x2008)
    {
        if (S[belowTile] != 0 || T[belowTile] != Tile.Space)
        {
            let state = u8(S[currentTile]);
            state = u8(state + 1);
            if (state == 0x22)
            {
                state = u8(0x30);
            }
            S[currentTile] = state;
            return;
        }
        S[currentTile] = 0;
        T[currentTile] = Tile.OrangeDisk;
        return;
    }
    if (S[belowTile] == 0 && T[belowTile] == Tile.Space)
    {
        S[currentTile] = 0x20;
        S[belowTile] = 8;
    }
}
function updateExplosionTiles(position: number): void
{
    let currentTile = position;
    if (T[currentTile] != Tile.Explosion)
    {
        return;
    }
    if ((gFrameCounter & 3) != 0)
    {
        return;
    }
    let state = u8(S[currentTile]);
    if ((state & 0x80) != 0)
    {
        state = u8(state + 1);
        if (state != 0x89)
        {
            S[currentTile] = state;
            state = u8(state - 1);
            state = u8(state & (0xF));
            let frameCoordinates = INFOTRON_EXPLOSION_FRAMES[state];
            drawMovingFrame(frameCoordinates[0],
                            frameCoordinates[1],
                            position);
        }
        else
        {
            S[currentTile] = 0;
            T[currentTile] = Tile.Infotron;
            gIsExplosionStarted = 0;
        }
    }
    else
    {
        state = u8(state + 1);
        S[currentTile] = state;
        state = u8(state - 1);
        let frameCoordinates = REGULAR_EXPLOSION_FRAMES[state];
        drawMovingFrame(frameCoordinates[0],
                        frameCoordinates[1],
                        position);
        if (S[currentTile] == 8)
        {
            S[currentTile] = 0;
            T[currentTile] = Tile.Space;
            gIsExplosionStarted = 0;
        }
    }
}
function updateExplosionTimers(): void
{
    for (let i = 0; i < kLevelSize; ++i)
    {
        let timer = s8(gExplosionTimers[i]);
        if (timer == 0)
        {
            continue;
        }
        if (timer < 0)
        {
            gExplosionTimers[i] = timer + 1;
            if (gExplosionTimers[i] == 0)
            {
                let tile = i;
                S[tile] = 0xFF;
                T[tile] = Tile.Electron;
                detonateBigExplosion(i);
            }
        }
        else
        {
            gExplosionTimers[i] = timer - 1;
            if (gExplosionTimers[i] == 0)
            {
                detonateBigExplosion(i);
            }
        }
    }
}
function detonateBigExplosionTile(position: number, newTile: number, newState: number, newExplosionTimer: number): void
{
    let currentTile = position;
    let hasChangedCurrentTile = u8(0);
    if (T[currentTile] == Tile.OrangeDisk || T[currentTile] == Tile.YellowDisk || T[currentTile] == Tile.SnikSnak)
    {
        if ((T[currentTile] as number) != Tile.Hardware)
        {
            gExplosionTimers[position] = newExplosionTimer;
        }
    }
    else if (T[currentTile] == Tile.Zonk)
    {
        detonateZonk(position, newState, newTile);
        hasChangedCurrentTile = u8(1);
    }
    else if (T[currentTile] == Tile.Infotron)
    {
        sub_4AA34(position, newState, newTile);
        hasChangedCurrentTile = u8(1);
    }
    else if (T[currentTile] == Tile.Electron)
    {
        newExplosionTimer = u8(-newExplosionTimer);
        newState = u8(0x80);
        newTile = u8(Tile.Explosion);
        if ((T[currentTile] as number) != Tile.Hardware)
        {
            gExplosionTimers[position] = newExplosionTimer;
        }
    }
    else if (T[currentTile] == Tile.Murphy)
    {
        gShouldKillMurphy = 1;
        if ((T[currentTile] as number) != Tile.Hardware)
        {
            gExplosionTimers[position] = newExplosionTimer;
        }
    }
    if (hasChangedCurrentTile == 0)
    {
        if ((T[currentTile] as number) != Tile.Hardware)
        {
            S[currentTile] = newState;
            T[currentTile] = newTile;
        }
    }
}
function detonateBigExplosion(position: number): void
{
    let currentTile = position;
    if (T[currentTile] == Tile.Hardware)
    {
        return;
    }
    let newState = u8(0);
    let newTile = u8(0);
    let newExplosionTimer = u8(0);
    gIsExplosionStarted = 1;
    if (T[currentTile] == Tile.Murphy)
    {
        gShouldKillMurphy = 1;
    }
    if (T[currentTile] == Tile.Electron)
    {
        newState = u8(0x80);
        newTile = u8(Tile.Explosion);
        newExplosionTimer = u8(-13);
    }
    else
    {
        newState = u8(0);
        newTile = u8(Tile.Explosion);
        newExplosionTimer = u8(13);
    }
    detonateBigExplosionTile(position - kLevelWidth - 1, newTile, newState, newExplosionTimer);
    detonateBigExplosionTile(position - kLevelWidth, newTile, newState, newExplosionTimer);
    detonateBigExplosionTile(position - kLevelWidth + 1, newTile, newState, newExplosionTimer);
    detonateBigExplosionTile(position - 1, newTile, newState, newExplosionTimer);
    S[currentTile] = newState;
    T[currentTile] = newTile;
    detonateBigExplosionTile(position + 1, newTile, newState, newExplosionTimer);
    detonateBigExplosionTile(position + kLevelWidth - 1, newTile, newState, newExplosionTimer);
    detonateBigExplosionTile(position + kLevelWidth, newTile, newState, newExplosionTimer);
    detonateBigExplosionTile(position + kLevelWidth + 1, newTile, newState, newExplosionTimer);
    playExplosionSound();
}
function updatePlantedRedDisk(): void
{
    if (gPlantedRedDiskCountdown <= 1)
    {
        return;
    }
    let tile = gPlantedRedDiskPosition;
    if (S[tile] == 0 && T[tile] == Tile.Space)
    {
        S[tile] = 0;
        T[tile] = Tile.RedDisk;
    }
    drawMovingFrame(256, 164, gPlantedRedDiskPosition);
    gPlantedRedDiskCountdown = u8(gPlantedRedDiskCountdown + 1);
    if (gPlantedRedDiskCountdown >= 0x28)
    {
        detonateBigExplosion(gPlantedRedDiskPosition);
        gPlantedRedDiskCountdown = u8(0);
    }
}
function detonateZonk(position: number, state: number, tile: number): void
{
    let currentTile = position;
    let belowTile = position + kLevelWidth;
    let stateType = u8(S[currentTile] & 0xF0);
    S[currentTile] = state;
    T[currentTile] = tile;
    if (stateType == 0x10 || stateType == 0x70)
    {
        sub_4AAB4(position - kLevelWidth);
        if (S[belowTile] == 0x99 && T[belowTile] == 0x99)
        {
            sub_4AAB4(position + kLevelWidth);
        }
    }
    else if (stateType == 0x20)
    {
        sub_4AAB4(position + 1);
        sub_4AAB4(position + kLevelWidth);
    }
    else if (stateType == 0x30)
    {
        sub_4AAB4(position - 1);
        sub_4AAB4(position + kLevelWidth);
    }
    else if (stateType == 0x50)
    {
        sub_4AAB4(position - 1);
    }
    else if (stateType == 0x60)
    {
        sub_4AAB4(position + 1);
    }
    else if (stateType == 0x70)
    {
        sub_4AAB4(position + kLevelWidth);
    }
}
function sub_4AA34(position: number, state: number, tile: number): void
{
    let currentTile = position;
    let belowTile = position + kLevelWidth;
    let stateType = u8(S[currentTile] & 0xF0);
    S[currentTile] = state;
    T[currentTile] = tile;
    if (stateType == 0x10 || stateType == 0x70)
    {
        sub_4AAB4(position - kLevelWidth);
        if (S[belowTile] == 0x99 && T[belowTile] == 0x99)
        {
            sub_4AAB4(position + kLevelWidth);
        }
    }
    else if (stateType == 0x20)
    {
        sub_4AAB4(position + 1);
        if (S[belowTile] == 0x99 && T[belowTile] == 0x99)
        {
            sub_4AAB4(position + kLevelWidth);
        }
    }
    else if (stateType == 0x30)
    {
        sub_4AAB4(position - 1);
        if (S[belowTile] == 0x99 && T[belowTile] == 0x99)
        {
            sub_4AAB4(position + kLevelWidth);
        }
    }
    else if (stateType == 0x50)
    {
        sub_4AAB4(position - 1);
    }
    else if (stateType == 0x60)
    {
        sub_4AAB4(position + 1);
    }
    else if (stateType == 0x70)
    {
        sub_4AAB4(position + kLevelWidth);
    }
}
function sub_4AAB4(position: number): void
{
    let currentTile = position;
    if (T[currentTile] == Tile.Explosion)
    {
        return;
    }
    S[currentTile] = 0;
    T[currentTile] = Tile.Space;
    let dstX = u16((position % kLevelWidth) * kTileSize);
    let dstY = u16((idiv(position, kLevelWidth)) * kTileSize);
    drawMovingSpriteFrameInLevel(0, 32, kTileSize, kTileSize, dstX, dstY);
}
function updateMurphy(position: number): number
{
    let murphyTile = position;
    let leftTile = position - 1;
    let rightTile = position + 1;
    let belowTile = position + kLevelWidth;
    let aboveTile = position - kLevelWidth;
    if (T[murphyTile] != Tile.Murphy)
    {
        gIsMurphyUpdated = 0;
        return position;
    }
    gIsMurphyUpdated = 1;
    gMurphyPreviousLocation = position;
    if (S[murphyTile] != 0 || T[murphyTile] != Tile.Murphy)
    {
        return updateMurphyAnimation(position);
    }
    gScratchGravity = 0;
    if (gIsGravityEnabled != 0 && T[aboveTile] != Tile.PortUp && T[aboveTile] != Tile.PortVertical && T[aboveTile] != Tile.Port4Way && (S[belowTile] == 0 && T[belowTile] == Tile.Space))
    {
        gScratchGravity = 1;
    }
    let userInput = u8(gCurrentUserInput);
    if (userInput == Input.None)
    {
        gPreviousUserInputWasNone = u8(1);
        if (gScratchGravity != 0)
        {
            let unknownMurphyData: MurphyAnimation;
            if (gIsMurphyLookingLeft != 0)
            {
                unknownMurphyData = MURPHY_ANIMATIONS[3];
            }
            else
            {
                unknownMurphyData = MURPHY_ANIMATIONS[4];
            }
            S[belowTile] = 3;
            T[belowTile] = Tile.Murphy;
            S[murphyTile] = 3;
            T[murphyTile] = Tile.Space;
            gMurphyCounterToStartPushAnimation = u8(0);
            gIsMurphyGoingThroughPortal = u16(0);
            return updateMurphyAnimationInfo(position + kLevelWidth, unknownMurphyData);
        }
        if ((gFrameCounter & 3) != 0)
        {
            return position;
        }
        gMurphyYawnAndSleepCounter = u16(gMurphyYawnAndSleepCounter + 1);
        if (gMurphyYawnAndSleepCounter == 4)
        {
            drawMovingFrame(304, 132, position);
            return position;
        }
        else if (gMurphyYawnAndSleepCounter <= 0x01F4)
        {
            return position;
        }
        else if (gMurphyYawnAndSleepCounter <= 0x020A)
        {
            let currentFrame = u16(gMurphyYawnAndSleepCounter - 0x1F4);
            currentFrame = u16(currentFrame >> 1);
            let animationFrameCoordinates = MURPHY_FRAMES[34];
            let frameCoordinates = animationFrameCoordinates[currentFrame];
            drawMovingFrame(frameCoordinates[0], frameCoordinates[1], position);
            return position;
        }
        else if (gMurphyYawnAndSleepCounter <= 0x03E8)
        {
            return position;
        }
        else if (gMurphyYawnAndSleepCounter <= 0x03FE)
        {
            let currentFrame = u16(gMurphyYawnAndSleepCounter - 0x3E8);
            currentFrame = u16(currentFrame >> 1);
            let animationFrameCoordinates = MURPHY_FRAMES[34];
            let frameCoordinates = animationFrameCoordinates[currentFrame];
            drawMovingFrame(frameCoordinates[0], frameCoordinates[1], position);
            return position;
        }
        else if (gMurphyYawnAndSleepCounter <= 0x0640)
        {
            return position;
        }
        else if (gMurphyYawnAndSleepCounter <= 0x0656)
        {
            let currentFrame = u16(gMurphyYawnAndSleepCounter - 0x640);
            currentFrame = u16(currentFrame >> 1);
            let animationFrameCoordinates = MURPHY_FRAMES[34];
            let frameCoordinates = animationFrameCoordinates[currentFrame];
            drawMovingFrame(frameCoordinates[0], frameCoordinates[1], position);
            return position;
        }
        else if (gMurphyYawnAndSleepCounter > 0x0676)
        {
            return position;
        }
        else if (S[leftTile] != 0 || T[leftTile] != Tile.Space)
        {
            let currentFrame = u16(gMurphyYawnAndSleepCounter - 0x656);
            currentFrame = u16(currentFrame >> 4);
            let animationFrameCoordinates = MURPHY_FRAMES[35];
            let frameCoordinates = animationFrameCoordinates[currentFrame];
            drawMovingFrame(frameCoordinates[0], frameCoordinates[1], position);
            return position;
        }
        else if (S[rightTile] != 0 || T[rightTile] != Tile.Space)
        {
            let currentFrame = u16(gMurphyYawnAndSleepCounter - 0x656);
            currentFrame = u16(currentFrame >> 4);
            let animationFrameCoordinates = MURPHY_FRAMES[36];
            let frameCoordinates = animationFrameCoordinates[currentFrame];
            drawMovingFrame(frameCoordinates[0], frameCoordinates[1], position);
            return position;
        }
        else
        {
            gMurphyYawnAndSleepCounter = u16(0x24);
            return position;
        }
    }
    if (gScratchGravity != 0 && (S[belowTile] == 0 && T[belowTile] == Tile.Space))
    {
        if (userInput != Input.Up || (S[aboveTile] != 0 || T[aboveTile] != Tile.Base))
        {
            if (userInput != Input.Left || (S[leftTile] != 0 || T[leftTile] != Tile.Base))
            {
                if (userInput != Input.Right || (S[rightTile] != 0 || T[rightTile] != Tile.Base))
                {
                    userInput = u8(Input.Down);
                }
            }
        }
    }
    if (userInput == Input.Up)
    {
        gPreviousUserInputWasNone = u8(0);
        return handleMurphyDirectionUp(position);
    }
    else if (userInput == Input.Left)
    {
        gPreviousUserInputWasNone = u8(0);
        return handleMurphyDirectionLeft(position);
    }
    else if (userInput == Input.Down)
    {
        gPreviousUserInputWasNone = u8(0);
        return handleMurphyDirectionDown(position);
    }
    else if (userInput == Input.Right)
    {
        gPreviousUserInputWasNone = u8(0);
        return handleMurphyDirectionRight(position);
    }
    else if (userInput == Input.SpaceUp)
    {
        gPreviousUserInputWasNone = u8(0);
        if (S[aboveTile] == 0 && T[aboveTile] == Tile.Base)
        {
            drawMovingFrame(160, 64, position);
            playBaseSound();
            S[murphyTile] = 0x10;
            gMurphyCounterToStartPushAnimation = u8(0);
            gIsMurphyGoingThroughPortal = u16(0);
            return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[13]);
        }
        else if (T[aboveTile] == Tile.Bug)
        {
            if (S[aboveTile] < 0x80)
            {
                detonateBigExplosion(position);
                return position;
            }
            S[aboveTile] = 0;
            T[aboveTile] = Tile.Base;
            drawMovingFrame(160, 64, position);
            playBaseSound();
            S[murphyTile] = 0x10;
            gMurphyCounterToStartPushAnimation = u8(0);
            gIsMurphyGoingThroughPortal = u16(0);
            return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[13]);
        }
        else if (S[aboveTile] == 0 && T[aboveTile] == Tile.Infotron)
        {
            drawMovingFrame(160, 64, position);
            playInfotronSound();
            S[murphyTile] = 0x14;
            S[aboveTile] = 0xFF;
            gMurphyCounterToStartPushAnimation = u8(0);
            gIsMurphyGoingThroughPortal = u16(0);
            return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[23]);
        }
        else if (T[aboveTile] == Tile.Terminal)
        {
            drawMovingFrame(160, 64, position);
            if (gAreYellowDisksDetonated != 0)
            {
                gMurphyYawnAndSleepCounter = u16(0xA);
                return position;
            }
            drawMovingFrame(256, 388, position - kLevelWidth);
            detonateYellowDisks();
            return position;
        }
        else if (T[aboveTile] == Tile.RedDisk)
        {
            S[murphyTile] = 0x20;
            S[aboveTile] = 3;
            gMurphyCounterToStartPushAnimation = u8(0);
            gIsMurphyGoingThroughPortal = u16(0);
            return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[39]);
        }
        else
        {
            return position;
        }
    }
    else if (userInput == Input.SpaceLeft)
    {
        gPreviousUserInputWasNone = u8(0);
        gIsMurphyLookingLeft = u8(1);
        if (S[leftTile] == 0 && T[leftTile] == Tile.Base)
        {
            drawMovingFrame(208, 16, position);
            playBaseSound();
            S[murphyTile] = 0x11;
            gMurphyCounterToStartPushAnimation = u8(0);
            gIsMurphyGoingThroughPortal = u16(0);
            return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[14]);
        }
        else if (T[leftTile] == Tile.Bug)
        {
            if (S[leftTile] < 0x80)
            {
                detonateBigExplosion(position);
                return position;
            }
            S[leftTile] = 0;
            T[leftTile] = Tile.Base;
            drawMovingFrame(208, 16, position);
            playBaseSound();
            S[murphyTile] = 0x11;
            gMurphyCounterToStartPushAnimation = u8(0);
            gIsMurphyGoingThroughPortal = u16(0);
            return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[14]);
        }
        else if (S[leftTile] == 0 && T[leftTile] == Tile.Infotron)
        {
            drawMovingFrame(208, 16, position);
            playInfotronSound();
            S[murphyTile] = 0x15;
            S[leftTile] = 0xFF;
            gMurphyCounterToStartPushAnimation = u8(0);
            gIsMurphyGoingThroughPortal = u16(0);
            return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[24]);
        }
        else if (T[leftTile] == Tile.Terminal)
        {
            drawMovingFrame(208, 16, position);
            if (gAreYellowDisksDetonated != 0)
            {
                gMurphyYawnAndSleepCounter = u16(0xA);
                return position;
            }
            drawMovingFrame(256, 388, position - 1);
            detonateYellowDisks();
            return position;
        }
        else if (T[leftTile] == Tile.RedDisk)
        {
            S[murphyTile] = 0x21;
            S[leftTile] = 3;
            gMurphyCounterToStartPushAnimation = u8(0);
            gIsMurphyGoingThroughPortal = u16(0);
            return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[40]);
        }
        else
        {
            return position;
        }
    }
    else if (userInput == Input.SpaceDown)
    {
        gPreviousUserInputWasNone = u8(0);
        if (S[belowTile] == 0 && T[belowTile] == Tile.Base)
        {
            drawMovingFrame(176, 64, position);
            playBaseSound();
            S[murphyTile] = 0x12;
            gMurphyCounterToStartPushAnimation = u8(0);
            gIsMurphyGoingThroughPortal = u16(0);
            return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[15]);
        }
        else if (T[belowTile] == Tile.Bug)
        {
            if (S[belowTile] < 0x80)
            {
                detonateBigExplosion(position);
                return position;
            }
            S[belowTile] = 0;
            T[belowTile] = Tile.Base;
            drawMovingFrame(176, 64, position);
            playBaseSound();
            S[murphyTile] = 0x12;
            gMurphyCounterToStartPushAnimation = u8(0);
            gIsMurphyGoingThroughPortal = u16(0);
            return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[15]);
        }
        else if (S[belowTile] == 0 && T[belowTile] == Tile.Infotron)
        {
            drawMovingFrame(176, 64, position);
            playInfotronSound();
            S[murphyTile] = 0x16;
            S[belowTile] = 0xFF;
            gMurphyCounterToStartPushAnimation = u8(0);
            gIsMurphyGoingThroughPortal = u16(0);
            return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[25]);
        }
        else if (T[belowTile] == Tile.Terminal)
        {
            drawMovingFrame(176, 64, position);
            if (gAreYellowDisksDetonated != 0)
            {
                gMurphyYawnAndSleepCounter = u16(0xA);
                return position;
            }
            drawMovingFrame(256, 388, position + kLevelWidth);
            detonateYellowDisks();
            return position;
        }
        else if (T[belowTile] == Tile.RedDisk)
        {
            S[murphyTile] = 0x22;
            S[belowTile] = 3;
            gMurphyCounterToStartPushAnimation = u8(0);
            gIsMurphyGoingThroughPortal = u16(0);
            return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[41]);
        }
        else
        {
            return position;
        }
    }
    else if (userInput == Input.SpaceRight)
    {
        gPreviousUserInputWasNone = u8(0);
        gIsMurphyLookingLeft = u8(0);
        if (S[rightTile] == 0 && T[rightTile] == Tile.Base)
        {
            drawMovingFrame(192, 16, position);
            playBaseSound();
            S[murphyTile] = 0x13;
            gMurphyCounterToStartPushAnimation = u8(0);
            gIsMurphyGoingThroughPortal = u16(0);
            return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[16]);
        }
        else if (T[rightTile] == Tile.Bug)
        {
            if (S[rightTile] < 0x80)
            {
                detonateBigExplosion(position);
                return position;
            }
            S[rightTile] = 0;
            T[rightTile] = Tile.Base;
            drawMovingFrame(192, 16, position);
            playBaseSound();
            S[murphyTile] = 0x13;
            gMurphyCounterToStartPushAnimation = u8(0);
            gIsMurphyGoingThroughPortal = u16(0);
            return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[16]);
        }
        else if (S[rightTile] == 0 && T[rightTile] == Tile.Infotron)
        {
            drawMovingFrame(192, 16, position);
            playInfotronSound();
            S[murphyTile] = 0x17;
            S[rightTile] = 0xFF;
            gMurphyCounterToStartPushAnimation = u8(0);
            gIsMurphyGoingThroughPortal = u16(0);
            return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[26]);
        }
        else if (T[rightTile] != Tile.Terminal)
        {
            if (T[rightTile] != Tile.RedDisk)
            {
                return position;
            }
            S[murphyTile] = 0x23;
            S[rightTile] = 3;
            gMurphyCounterToStartPushAnimation = u8(0);
            gIsMurphyGoingThroughPortal = u16(0);
            return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[42]);
        }
        else
        {
            drawMovingFrame(192, 16, position);
            if (gAreYellowDisksDetonated != 0)
            {
                gMurphyYawnAndSleepCounter = u16(0xA);
                return position;
            }
            drawMovingFrame(256, 388, position + 1);
            detonateYellowDisks();
            return position;
        }
    }
    else if (userInput == Input.SpaceOnly)
    {
        if (gNumberOfRemainingRedDisks == 0 || gPlantedRedDiskCountdown != 0 || gPreviousUserInputWasNone != 1)
        {
            return position;
        }
        S[murphyTile] = 0x2A;
        gMurphyCounterToStartPushAnimation = u8(0x40);
        gPlantedRedDiskCountdown = u8(1);
        gPlantedRedDiskPosition = position;
        return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[49]);
    }
    else
    {
        gPreviousUserInputWasNone = u8(0);
        return position;
    }
}
function handleMurphyDirectionUp(position: number): number
{
    let murphyTile = position;
    let aboveTile = position - kLevelWidth;
    let aboveAboveTile = position - kLevelWidth * 2;
    if (S[aboveTile] == 0 && T[aboveTile] == Tile.Space)
    {
        let animationDescriptor: MurphyAnimation;
        if (gIsMurphyLookingLeft != 0)
        {
            animationDescriptor = MURPHY_ANIMATIONS[0];
        }
        else
        {
            animationDescriptor = MURPHY_ANIMATIONS[1];
        }
        S[aboveTile] = 1;
        T[aboveTile] = Tile.Murphy;
        S[murphyTile] = 3;
        T[murphyTile] = Tile.Space;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position - kLevelWidth, animationDescriptor);
    }
    else if (S[aboveTile] == 0 && T[aboveTile] == Tile.Base)
    {
        let unknownMurphyData: MurphyAnimation;
        playBaseSound();
        if (gIsMurphyLookingLeft != 0)
        {
            unknownMurphyData = MURPHY_ANIMATIONS[7];
        }
        else
        {
            unknownMurphyData = MURPHY_ANIMATIONS[8];
        }
        S[aboveTile] = 5;
        T[aboveTile] = Tile.Murphy;
        S[murphyTile] = 3;
        T[murphyTile] = Tile.Space;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position - kLevelWidth, unknownMurphyData);
    }
    else if (T[aboveTile] == Tile.Bug)
    {
        if (S[aboveTile] < 0x80)
        {
            detonateBigExplosion(position);
            return position;
        }
        S[aboveTile] = 0;
        T[aboveTile] = Tile.Base;
        let animationDescriptor: MurphyAnimation;
        playBaseSound();
        if (gIsMurphyLookingLeft != 0)
        {
            animationDescriptor = MURPHY_ANIMATIONS[7];
        }
        else
        {
            animationDescriptor = MURPHY_ANIMATIONS[8];
        }
        S[aboveTile] = 5;
        T[aboveTile] = Tile.Murphy;
        S[murphyTile] = 3;
        T[murphyTile] = Tile.Space;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position - kLevelWidth, animationDescriptor);
    }
    else if (S[aboveTile] == 0 && T[aboveTile] == Tile.Infotron)
    {
        let unknownMurphyData: MurphyAnimation;
        playInfotronSound();
        if (gIsMurphyLookingLeft != 0)
        {
            unknownMurphyData = MURPHY_ANIMATIONS[17];
        }
        else
        {
            unknownMurphyData = MURPHY_ANIMATIONS[18];
        }
        S[aboveTile] = 9;
        T[aboveTile] = Tile.Murphy;
        S[murphyTile] = 3;
        T[murphyTile] = Tile.Space;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position - kLevelWidth, unknownMurphyData);
    }
    else if (S[aboveTile] == 0 && T[aboveTile] == Tile.Exit)
    {
        if (gNumberOfRemainingInfotrons != 0)
        {
            return position;
        }
        playExitSound();
        gLevelFailed = 0;
        gQuitLevelCountdown = u16(0x40);
        S[murphyTile] = 0xD;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[6]);
    }
    else if (T[aboveTile] == Tile.Terminal)
    {
        drawMovingFrame(160, 64, position);
        if (gAreYellowDisksDetonated != 0)
        {
            gMurphyYawnAndSleepCounter = u16(0xA);
            return position;
        }
        drawMovingFrame(256, 388, position - kLevelWidth);
        detonateYellowDisks();
        return position;
    }
    else if (T[aboveTile] == Tile.PortUp || T[aboveTile] == Tile.PortVertical || T[aboveTile] == Tile.Port4Way)
    {
        if (S[aboveAboveTile] != 0 || T[aboveAboveTile] != Tile.Space)
        {
            return position;
        }
        S[murphyTile] = 0x18;
        S[aboveAboveTile] = 3;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(1);
        return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[29]);
    }
    else if (T[aboveTile] == Tile.RedDisk)
    {
        let unknownMurphyData: MurphyAnimation;
        if (gIsMurphyLookingLeft != 0)
        {
            unknownMurphyData = MURPHY_ANIMATIONS[33];
        }
        else
        {
            unknownMurphyData = MURPHY_ANIMATIONS[34];
        }
        S[murphyTile] = 0x1C;
        S[aboveTile] = 3;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position, unknownMurphyData);
    }
    else if (T[aboveTile] == Tile.YellowDisk)
    {
        if (S[aboveAboveTile] != 0 || T[aboveAboveTile] != Tile.Space)
        {
            return position;
        }
        S[aboveAboveTile] = 0x12;
        drawMovingFrame(97, 132, position);
        S[murphyTile] = 0x24;
        gMurphyCounterToStartPushAnimation = u8(8);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[43]);
    }
    else if (checkMurphyMovementToPosition(position - kLevelWidth, Input.Up) != 1)
    {
        return handleMurphyDirectionUp(position);
    }
    else
    {
        return position;
    }
}
function handleMurphyDirectionLeft(position: number): number
{
    let murphyTile = position;
    let leftLeftTile = position - 2;
    let leftTile = position - 1;
    gIsMurphyLookingLeft = u8(1);
    if (S[leftTile] == 0 && T[leftTile] == Tile.Space)
    {
        S[leftTile] = 2;
        T[leftTile] = Tile.Murphy;
        S[murphyTile] = 3;
        T[murphyTile] = Tile.Space;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position - 1, MURPHY_ANIMATIONS[2]);
    }
    else if (S[leftTile] == 0 && T[leftTile] == Tile.Base)
    {
        playBaseSound();
        S[leftTile] = 2;
        T[leftTile] = Tile.Murphy;
        S[murphyTile] = 3;
        T[murphyTile] = Tile.Space;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position - 1, MURPHY_ANIMATIONS[9]);
    }
    else if (T[leftTile] == Tile.Bug)
    {
        if (S[leftTile] < 0x80)
        {
            detonateBigExplosion(position);
            return position;
        }
        S[leftTile] = 0;
        T[leftTile] = Tile.Base;
        playBaseSound();
        S[leftTile] = 2;
        T[leftTile] = Tile.Murphy;
        S[murphyTile] = 3;
        T[murphyTile] = Tile.Space;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position - 1, MURPHY_ANIMATIONS[9]);
    }
    else if (S[leftTile] == 0 && T[leftTile] == Tile.Infotron)
    {
        playInfotronSound();
        S[leftTile] = 10;
        T[leftTile] = Tile.Murphy;
        S[murphyTile] = 3;
        T[murphyTile] = Tile.Space;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position - 1, MURPHY_ANIMATIONS[19]);
    }
    else if (S[leftTile] == 0 && T[leftTile] == Tile.Exit)
    {
        if (gNumberOfRemainingInfotrons != 0)
        {
            return position;
        }
        playExitSound();
        gLevelFailed = 0;
        gQuitLevelCountdown = u16(0x40);
        S[murphyTile] = 0xD;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[6]);
    }
    else if (S[leftTile] == 0 && T[leftTile] == Tile.Zonk)
    {
        if (S[leftLeftTile] != 0 || T[leftLeftTile] != Tile.Space)
        {
            return position;
        }
        S[leftLeftTile] = 1;
        drawMovingFrame(64, 132, position);
        S[murphyTile] = 0xE;
        gMurphyCounterToStartPushAnimation = u8(8);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[27]);
    }
    else if (T[leftTile] == Tile.Terminal)
    {
        drawMovingFrame(208, 16, position);
        if (gAreYellowDisksDetonated != 0)
        {
            gMurphyYawnAndSleepCounter = u16(0xA);
            return position;
        }
        drawMovingFrame(256, 388, position - 1);
        detonateYellowDisks();
        return position;
    }
    else if (T[leftTile] == Tile.PortLeft || T[leftTile] == Tile.PortHorizontal || T[leftTile] == Tile.Port4Way)
    {
        if (S[leftLeftTile] != 0 || T[leftLeftTile] != Tile.Space)
        {
            return position;
        }
        S[murphyTile] = 0x19;
        S[leftLeftTile] = 3;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(1);
        return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[30]);
    }
    else if (S[leftTile] == 0 && T[leftTile] == Tile.RedDisk)
    {
        S[leftTile] = 0x1D;
        T[leftTile] = Tile.Murphy;
        S[murphyTile] = 3;
        T[murphyTile] = Tile.Space;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position - 1, MURPHY_ANIMATIONS[35]);
    }
    else if (S[leftTile] == 0 && T[leftTile] == Tile.YellowDisk)
    {
        if (S[leftLeftTile] != 0 || T[leftLeftTile] != Tile.Space)
        {
            return position;
        }
        S[leftLeftTile] = 0x12;
        drawMovingFrame(64, 132, position);
        S[murphyTile] = 0x25;
        gMurphyCounterToStartPushAnimation = u8(8);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[44]);
    }
    else if (S[leftTile] == 0 && T[leftTile] == Tile.OrangeDisk)
    {
        if (S[leftLeftTile] != 0 || T[leftLeftTile] != Tile.Space)
        {
            return position;
        }
        S[leftLeftTile] = 8;
        drawMovingFrame(64, 132, position);
        S[murphyTile] = 0x28;
        gMurphyCounterToStartPushAnimation = u8(8);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[47]);
    }
    else if (checkMurphyMovementToPosition(position - 1, Input.Left) != 1)
    {
        return handleMurphyDirectionLeft(position);
    }
    else
    {
        return position;
    }
}
function handleMurphyDirectionDown(position: number): number
{
    let murphyTile = position;
    let belowTile = position + kLevelWidth;
    let belowBelowTile = position + kLevelWidth * 2;
    if (S[belowTile] == 0 && T[belowTile] == Tile.Space)
    {
        let unknownMurphyData: MurphyAnimation;
        if (gIsMurphyLookingLeft != 0)
        {
            unknownMurphyData = MURPHY_ANIMATIONS[3];
        }
        else
        {
            unknownMurphyData = MURPHY_ANIMATIONS[4];
        }
        S[belowTile] = 3;
        T[belowTile] = Tile.Murphy;
        S[murphyTile] = 3;
        T[murphyTile] = Tile.Space;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position + kLevelWidth, unknownMurphyData);
    }
    else if (S[belowTile] == 0 && T[belowTile] == Tile.Base)
    {
        let unknownMurphyData: MurphyAnimation;
        playBaseSound();
        if (gIsMurphyLookingLeft != 0)
        {
            unknownMurphyData = MURPHY_ANIMATIONS[10];
        }
        else
        {
            unknownMurphyData = MURPHY_ANIMATIONS[11];
        }
        S[belowTile] = 7;
        T[belowTile] = Tile.Murphy;
        S[murphyTile] = 3;
        T[murphyTile] = Tile.Space;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position + kLevelWidth, unknownMurphyData);
    }
    else if (T[belowTile] == Tile.Bug)
    {
        if (S[belowTile] < 0x80)
        {
            detonateBigExplosion(position);
            return position;
        }
        S[belowTile] = 0;
        T[belowTile] = Tile.Base;
        let unknownMurphyData: MurphyAnimation;
        playBaseSound();
        if (gIsMurphyLookingLeft != 0)
        {
            unknownMurphyData = MURPHY_ANIMATIONS[10];
        }
        else
        {
            unknownMurphyData = MURPHY_ANIMATIONS[11];
        }
        S[belowTile] = 7;
        T[belowTile] = Tile.Murphy;
        S[murphyTile] = 3;
        T[murphyTile] = Tile.Space;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position + kLevelWidth, unknownMurphyData);
    }
    else if (S[belowTile] == 0 && T[belowTile] == Tile.Infotron)
    {
        let unknownMurphyData: MurphyAnimation;
        playInfotronSound();
        if (gIsMurphyLookingLeft != 0)
        {
            unknownMurphyData = MURPHY_ANIMATIONS[20];
        }
        else
        {
            unknownMurphyData = MURPHY_ANIMATIONS[21];
        }
        S[belowTile] = 11;
        T[belowTile] = Tile.Murphy;
        S[murphyTile] = 3;
        T[murphyTile] = Tile.Space;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position + kLevelWidth, unknownMurphyData);
    }
    else if (S[belowTile] == 0 && T[belowTile] == Tile.Exit)
    {
        if (gNumberOfRemainingInfotrons != 0)
        {
            return position;
        }
        playExitSound();
        gLevelFailed = 0;
        gQuitLevelCountdown = u16(0x40);
        S[murphyTile] = 0xD;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[6]);
    }
    else if (T[belowTile] == Tile.Terminal)
    {
        drawMovingFrame(176, 64, position);
        if (gAreYellowDisksDetonated != 0)
        {
            gMurphyYawnAndSleepCounter = u16(0xA);
            return position;
        }
        drawMovingFrame(256, 388, position + kLevelWidth);
        detonateYellowDisks();
        return position;
    }
    else if (T[belowTile] == Tile.PortDown || T[belowTile] == Tile.PortVertical || T[belowTile] == Tile.Port4Way)
    {
        if (S[belowBelowTile] != 0 || T[belowBelowTile] != Tile.Space)
        {
            return position;
        }
        S[murphyTile] = 0x1A;
        S[belowBelowTile] = 3;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(1);
        return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[31]);
    }
    else if (T[belowTile] == Tile.RedDisk)
    {
        let unknownMurphyData: MurphyAnimation;
        if (gIsMurphyLookingLeft != 0)
        {
            unknownMurphyData = MURPHY_ANIMATIONS[36];
        }
        else
        {
            unknownMurphyData = MURPHY_ANIMATIONS[37];
        }
        S[murphyTile] = 0x1E;
        S[belowTile] = 3;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position, unknownMurphyData);
    }
    else if (T[belowTile] == Tile.YellowDisk)
    {
        if (S[belowBelowTile] != 0 || T[belowBelowTile] != Tile.Space)
        {
            return position;
        }
        S[belowBelowTile] = 0x12;
        drawMovingFrame(97, 132, position);
        S[murphyTile] = 0x27;
        gMurphyCounterToStartPushAnimation = u8(8);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[45]);
    }
    else if (checkMurphyMovementToPosition(position + kLevelWidth, Input.Down) != 1)
    {
        return handleMurphyDirectionDown(position);
    }
    else
    {
        return position;
    }
}
function handleMurphyDirectionRight(position: number): number
{
    let murphyTile = position;
    let rightTile = position + 1;
    let rightRightTile = position + 2;
    let belowRightTile = position + kLevelWidth + 1;
    gIsMurphyLookingLeft = u8(0);
    if (S[rightTile] == 0 && T[rightTile] == Tile.Space)
    {
        S[rightTile] = 4;
        T[rightTile] = Tile.Murphy;
        S[murphyTile] = 3;
        T[murphyTile] = Tile.Space;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position + 1, MURPHY_ANIMATIONS[5]);
    }
    else if (S[rightTile] == 0 && T[rightTile] == Tile.Base)
    {
        playBaseSound();
        S[rightTile] = 8;
        T[rightTile] = Tile.Murphy;
        S[murphyTile] = 3;
        T[murphyTile] = Tile.Space;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position + 1, MURPHY_ANIMATIONS[12]);
    }
    else if (T[rightTile] == Tile.Bug)
    {
        if (S[rightTile] < 0x80)
        {
            detonateBigExplosion(position);
            return position;
        }
        S[rightTile] = 0;
        T[rightTile] = Tile.Base;
        playBaseSound();
        S[rightTile] = 8;
        T[rightTile] = Tile.Murphy;
        S[murphyTile] = 3;
        T[murphyTile] = Tile.Space;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position + 1, MURPHY_ANIMATIONS[12]);
    }
    else if (S[rightTile] == 0 && T[rightTile] == Tile.Infotron)
    {
        playInfotronSound();
        S[rightTile] = 12;
        T[rightTile] = Tile.Murphy;
        S[murphyTile] = 3;
        T[murphyTile] = Tile.Space;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position + 1, MURPHY_ANIMATIONS[22]);
    }
    else if (S[rightTile] == 0 && T[rightTile] == Tile.Exit)
    {
        if (gNumberOfRemainingInfotrons != 0)
        {
            return position;
        }
        playExitSound();
        gLevelFailed = 0;
        gQuitLevelCountdown = u16(0x40);
        S[murphyTile] = 0xD;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[6]);
    }
    else if (S[rightTile] == 0 && T[rightTile] == Tile.Zonk)
    {
        if (S[rightRightTile] != 0 || T[rightRightTile] != Tile.Space)
        {
            return position;
        }
        if (S[belowRightTile] == 0 && T[belowRightTile] == Tile.Space)
        {
            return position;
        }
        S[rightRightTile] = 1;
        drawMovingFrame(97, 132, position);
        S[murphyTile] = 0xF;
        gMurphyCounterToStartPushAnimation = u8(8);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[28]);
    }
    else if (T[rightTile] == Tile.Terminal)
    {
        drawMovingFrame(192, 16, position);
        if (gAreYellowDisksDetonated != 0)
        {
            gMurphyYawnAndSleepCounter = u16(0xA);
            return position;
        }
        drawMovingFrame(256, 388, position + 1);
        detonateYellowDisks();
        return position;
    }
    else if (T[rightTile] == Tile.PortRight || T[rightTile] == Tile.PortHorizontal || T[rightTile] == Tile.Port4Way)
    {
        if (S[rightRightTile] != 0 || T[rightRightTile] != Tile.Space)
        {
            return position;
        }
        S[murphyTile] = 0x1B;
        S[rightRightTile] = 3;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(1);
        return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[32]);
    }
    else if (T[rightTile] == Tile.RedDisk)
    {
        S[rightTile] = 0x1F;
        T[rightTile] = Tile.Murphy;
        S[murphyTile] = 3;
        T[murphyTile] = Tile.Space;
        gMurphyCounterToStartPushAnimation = u8(0);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position + 1, MURPHY_ANIMATIONS[38]);
    }
    else if (T[rightTile] == Tile.YellowDisk)
    {
        if (S[rightRightTile] != 0 || T[rightRightTile] != Tile.Space)
        {
            return position;
        }
        S[rightRightTile] = 0x12;
        drawMovingFrame(97, 132, position);
        S[murphyTile] = 0x26;
        gMurphyCounterToStartPushAnimation = u8(8);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[46]);
    }
    else if (S[rightTile] == 0 && T[rightTile] == Tile.OrangeDisk)
    {
        if (S[rightRightTile] != 0 || T[rightRightTile] != Tile.Space)
        {
            return position;
        }
        if (S[belowRightTile] == 0 && T[belowRightTile] == Tile.Space)
        {
            return position;
        }
        S[rightRightTile] = 1;
        drawMovingFrame(97, 132, position);
        S[murphyTile] = 0x29;
        gMurphyCounterToStartPushAnimation = u8(8);
        gIsMurphyGoingThroughPortal = u16(0);
        return updateMurphyAnimationInfo(position, MURPHY_ANIMATIONS[48]);
    }
    else if (checkMurphyMovementToPosition(position + 1, Input.Right) != 1)
    {
        return handleMurphyDirectionRight(position);
    }
    else
    {
        return position;
    }
}
function updateMurphyAnimationInfo(position: number, unknownMurphyData: MurphyAnimation): number
{
    gCurrentMurphyAnimation = { ...unknownMurphyData, currentFrame: 0 };
    return updateMurphyAnimation(position);
}
function updateMurphyAnimation(position: number): number
{
    let murphyTile = position;
    let leftLeftTile = position - 2;
    let leftTile = position - 1;
    let rightTile = position + 1;
    let rightRightTile = position + 2;
    let belowTile = position + kLevelWidth;
    let belowBelowTile = position + kLevelWidth * 2;
    let aboveTile = position - kLevelWidth;
    let aboveAboveTile = position - kLevelWidth * 2;
    let belowRightRightTile = position + kLevelWidth + 2;
    gMurphyYawnAndSleepCounter = u16(0);
    if (gMurphyCounterToStartPushAnimation == 0)
    {
        let currentFrame = u8(gCurrentMurphyAnimation.currentFrame);
        let animationFrameCoordinates = MURPHY_FRAMES[gCurrentMurphyAnimation.animation];
        let frameCoordinates = animationFrameCoordinates[currentFrame];
        gMurphyPositionX = u16(gMurphyPositionX + (gCurrentMurphyAnimation.speedX));
        gMurphyPositionY = u16(gMurphyPositionY + (gCurrentMurphyAnimation.speedY));
        gCurrentMurphyAnimation.currentFrame++;
        let dstX = u16((position % kLevelWidth) * kTileSize);
        let dstY = u16((idiv(position, kLevelWidth)) * kTileSize);
        let offsetX = s16((gCurrentMurphyAnimation.offset % 122) * 8);
        let offsetY = s16((idiv(gCurrentMurphyAnimation.offset, 122)));
        drawMovingSpriteFrameInLevel(frameCoordinates[0],
                                     frameCoordinates[1],
                                     gCurrentMurphyAnimation.width * 8,
                                     gCurrentMurphyAnimation.height,
                                     dstX + offsetX,
                                     dstY + offsetY);
        if (gIsMurphyGoingThroughPortal != 0)
        {
            let animationFrameCoordinates = MURPHY_FRAMES[gCurrentMurphyAnimation.animation + 1];
            let frameCoordinates = animationFrameCoordinates[currentFrame];
            let offsetX = s16((gCurrentMurphyAnimation.increment % 122) * 8);
            let offsetY = s16((idiv(gCurrentMurphyAnimation.increment, 122)));
            drawMovingSpriteFrameInLevel(frameCoordinates[0],
                                         frameCoordinates[1],
                                         gCurrentMurphyAnimation.width * 8,
                                         gCurrentMurphyAnimation.height,
                                         dstX + offsetX,
                                         dstY + offsetY);
        }
        else
        {
            gCurrentMurphyAnimation.offset += gCurrentMurphyAnimation.increment;
        }
        if (gCurrentMurphyAnimation.currentFrame < animationFrameCoordinates.length)
        {
            return position;
        }
        gMurphyTileX = u16(gMurphyTileX + (idiv(gCurrentMurphyAnimation.speedX, 2)));
        gMurphyTileY = u16(gMurphyTileY + (idiv(gCurrentMurphyAnimation.speedY, 2)));
        let previousMurphyMovingObject = u8(S[murphyTile]);
        S[murphyTile] = 0;
        if (previousMurphyMovingObject == 1)
        {
            T[murphyTile] = Tile.Murphy;
            handleMurphyCollisionAfterMovement(position + kLevelWidth);
            return position;
        }
        else if (previousMurphyMovingObject == 2)
        {
            T[murphyTile] = Tile.Murphy;
            handleMurphyCollisionAfterMovement(position + 1);
            return position;
        }
        else if (previousMurphyMovingObject == 3)
        {
            if (T[aboveTile] != Tile.Explosion)
            {
                S[aboveTile] = 0;
                T[aboveTile] = Tile.Space;
            }
            S[murphyTile] = 0;
            T[murphyTile] = Tile.Murphy;
            return position;
        }
        else if (previousMurphyMovingObject == 4)
        {
            handleMurphyCollisionAfterMovement(position - 1);
            S[murphyTile] = 0;
            T[murphyTile] = Tile.Murphy;
            return position;
        }
        else if (previousMurphyMovingObject == 5)
        {
            T[murphyTile] = Tile.Murphy;
            handleMurphyCollisionAfterMovement(position + kLevelWidth);
            return position;
        }
        else if (previousMurphyMovingObject == 6)
        {
            T[murphyTile] = Tile.Murphy;
            handleMurphyCollisionAfterMovement(position + 1);
            return position;
        }
        else if (previousMurphyMovingObject == 7)
        {
            if (T[aboveTile] != Tile.Explosion)
            {
                S[aboveTile] = 0;
                T[aboveTile] = Tile.Space;
            }
            S[murphyTile] = 0;
            T[murphyTile] = Tile.Murphy;
            return position;
        }
        else if (previousMurphyMovingObject == 8)
        {
            handleMurphyCollisionAfterMovement(position - 1);
            S[murphyTile] = 0;
            T[murphyTile] = Tile.Murphy;
            return position;
        }
        else if (previousMurphyMovingObject == 9)
        {
            if (gNumberOfRemainingInfotrons > 0)
            {
                gNumberOfRemainingInfotrons = u8(gNumberOfRemainingInfotrons - 1);
            }
            drawNumberOfRemainingInfotrons();
            T[murphyTile] = Tile.Murphy;
            handleMurphyCollisionAfterMovement(position + kLevelWidth);
            return position;
        }
        else if (previousMurphyMovingObject == 10)
        {
            if (gNumberOfRemainingInfotrons > 0)
            {
                gNumberOfRemainingInfotrons = u8(gNumberOfRemainingInfotrons - 1);
            }
            drawNumberOfRemainingInfotrons();
            T[murphyTile] = Tile.Murphy;
            handleMurphyCollisionAfterMovement(position + 1);
            return position;
        }
        else if (previousMurphyMovingObject == 11)
        {
            if (gNumberOfRemainingInfotrons > 0)
            {
                gNumberOfRemainingInfotrons = u8(gNumberOfRemainingInfotrons - 1);
            }
            drawNumberOfRemainingInfotrons();
            if (T[aboveTile] != Tile.Explosion)
            {
                S[aboveTile] = 0;
                T[aboveTile] = Tile.Space;
            }
            S[murphyTile] = 0;
            T[murphyTile] = Tile.Murphy;
            return position;
        }
        else if (previousMurphyMovingObject == 12)
        {
            if (gNumberOfRemainingInfotrons > 0)
            {
                gNumberOfRemainingInfotrons = u8(gNumberOfRemainingInfotrons - 1);
            }
            drawNumberOfRemainingInfotrons();
            handleMurphyCollisionAfterMovement(position - 1);
            S[murphyTile] = 0;
            T[murphyTile] = Tile.Murphy;
            return position;
        }
        else if (previousMurphyMovingObject == 14)
        {
            if (T[murphyTile] != Tile.Explosion)
            {
                S[murphyTile] = 0;
                T[murphyTile] = Tile.Space;
            }
            S[leftTile] = 0;
            T[leftTile] = Tile.Murphy;
            S[leftLeftTile] = 0;
            T[leftLeftTile] = Tile.Zonk;
            handleZonkPushedByMurphy(position - 2);
            return position - 1;
        }
        else if (previousMurphyMovingObject == 15)
        {
            if (T[murphyTile] != Tile.Explosion)
            {
                S[murphyTile] = 0;
                T[murphyTile] = Tile.Space;
            }
            S[rightTile] = 0;
            T[rightTile] = Tile.Murphy;
            S[rightRightTile] = 0;
            T[rightRightTile] = Tile.Zonk;
            handleZonkPushedByMurphy(position + 2);
            return position + 1;
        }
        else if (previousMurphyMovingObject == 16)
        {
            if (T[aboveTile] != Tile.Explosion)
            {
                S[aboveTile] = 0;
                T[aboveTile] = Tile.Space;
            }
            return position;
        }
        else if (previousMurphyMovingObject == 17)
        {
            if (T[leftTile] != Tile.Explosion)
            {
                S[leftTile] = 0;
                T[leftTile] = Tile.Space;
            }
            return position;
        }
        else if (previousMurphyMovingObject == 19)
        {
            if (T[rightTile] != Tile.Explosion)
            {
                S[rightTile] = 0;
                T[rightTile] = Tile.Space;
            }
            return position;
        }
        else if (previousMurphyMovingObject == 18)
        {
            if (T[belowTile] != Tile.Explosion)
            {
                S[belowTile] = 0;
                T[belowTile] = Tile.Space;
            }
            return position;
        }
        else if (previousMurphyMovingObject == 20)
        {
            if (gNumberOfRemainingInfotrons > 0)
            {
                gNumberOfRemainingInfotrons = u8(gNumberOfRemainingInfotrons - 1);
            }
            drawNumberOfRemainingInfotrons();
            if (T[aboveTile] != Tile.Explosion)
            {
                S[aboveTile] = 0;
                T[aboveTile] = Tile.Space;
            }
            return position;
        }
        else if (previousMurphyMovingObject == 21)
        {
            if (gNumberOfRemainingInfotrons > 0)
            {
                gNumberOfRemainingInfotrons = u8(gNumberOfRemainingInfotrons - 1);
            }
            drawNumberOfRemainingInfotrons();
            if (T[leftTile] != Tile.Explosion)
            {
                S[leftTile] = 0;
                T[leftTile] = Tile.Space;
            }
            return position;
        }
        else if (previousMurphyMovingObject == 23)
        {
            if (gNumberOfRemainingInfotrons > 0)
            {
                gNumberOfRemainingInfotrons = u8(gNumberOfRemainingInfotrons - 1);
            }
            drawNumberOfRemainingInfotrons();
            if (T[rightTile] != Tile.Explosion)
            {
                S[rightTile] = 0;
                T[rightTile] = Tile.Space;
            }
            return position;
        }
        else if (previousMurphyMovingObject == 22)
        {
            if (gNumberOfRemainingInfotrons > 0)
            {
                gNumberOfRemainingInfotrons = u8(gNumberOfRemainingInfotrons - 1);
            }
            drawNumberOfRemainingInfotrons();
            if (T[belowTile] != Tile.Explosion)
            {
                S[belowTile] = 0;
                T[belowTile] = Tile.Space;
            }
            return position;
        }
        else if (previousMurphyMovingObject == 13)
        {
            gShouldExitLevel = 1;
            return position;
        }
        else if (previousMurphyMovingObject == 24)
        {
            if (T[murphyTile] != Tile.Explosion)
            {
                S[murphyTile] = 0;
                T[murphyTile] = Tile.Space;
            }
            S[aboveAboveTile] = 0;
            T[aboveAboveTile] = Tile.Murphy;
            gIsMurphyGoingThroughPortal = u16(0);
            position = s16(position - (kLevelWidth * 2));
            if (S[aboveTile] == 1)
            {
                updateSpecialPort(position + kLevelWidth);
            }
            return position;
        }
        else if (previousMurphyMovingObject == 25)
        {
            if (T[murphyTile] != Tile.Explosion)
            {
                S[murphyTile] = 0;
                T[murphyTile] = Tile.Space;
            }
            S[leftLeftTile] = 0;
            T[leftLeftTile] = Tile.Murphy;
            gIsMurphyGoingThroughPortal = u16(0);
            position = s16(position - (2));
            if (S[leftTile] == 1)
            {
                updateSpecialPort(position + 1);
            }
            return position;
        }
        else if (previousMurphyMovingObject == 26)
        {
            if (T[murphyTile] != Tile.Explosion)
            {
                S[murphyTile] = 0;
                T[murphyTile] = Tile.Space;
            }
            S[belowBelowTile] = 0;
            T[belowBelowTile] = Tile.Murphy;
            gIsMurphyGoingThroughPortal = u16(0);
            position = s16(position + (kLevelWidth * 2));
            if (S[belowTile] == 1)
            {
                updateSpecialPort(position - kLevelWidth);
            }
            return position;
        }
        else if (previousMurphyMovingObject == 27)
        {
            if (T[murphyTile] != Tile.Explosion)
            {
                S[murphyTile] = 0;
                T[murphyTile] = Tile.Space;
            }
            S[rightRightTile] = 0;
            T[rightRightTile] = Tile.Murphy;
            gIsMurphyGoingThroughPortal = u16(0);
            position = s16(position + (2));
            if (S[rightTile] == 1)
            {
                updateSpecialPort(position - 1);
            }
            return position;
        }
        else if (previousMurphyMovingObject == 28)
        {
            if (T[murphyTile] != Tile.Explosion)
            {
                S[murphyTile] = 0;
                T[murphyTile] = Tile.Space;
            }
            position = s16(position - (kLevelWidth));
            S[aboveTile] = 0;
            T[aboveTile] = Tile.Murphy;
            decreaseRemainingRedDisksIfNeeded(position);
            return position;
        }
        else if (previousMurphyMovingObject == 29)
        {
            if (T[rightTile] != Tile.Explosion)
            {
                S[rightTile] = 0;
                T[rightTile] = Tile.Space;
            }
            S[murphyTile] = 0;
            T[murphyTile] = Tile.Murphy;
            decreaseRemainingRedDisksIfNeeded(position);
            return position;
        }
        else if (previousMurphyMovingObject == 30)
        {
            if (T[murphyTile] != Tile.Explosion)
            {
                S[murphyTile] = 0;
                T[murphyTile] = Tile.Space;
            }
            position = s16(position + (kLevelWidth));
            S[belowTile] = 0;
            T[belowTile] = Tile.Murphy;
            decreaseRemainingRedDisksIfNeeded(position);
            return position;
        }
        else if (previousMurphyMovingObject == 31)
        {
            if (T[leftTile] != Tile.Explosion)
            {
                S[leftTile] = 0;
                T[leftTile] = Tile.Space;
            }
            S[murphyTile] = 0;
            T[murphyTile] = Tile.Murphy;
            decreaseRemainingRedDisksIfNeeded(position);
            return position;
        }
        else if (previousMurphyMovingObject == 32)
        {
            if (T[aboveTile] != Tile.Explosion)
            {
                S[aboveTile] = 0;
                T[aboveTile] = Tile.Space;
            }
            decreaseRemainingRedDisksIfNeeded(position - kLevelWidth);
            return position;
        }
        else if (previousMurphyMovingObject == 33)
        {
            if (T[leftTile] != Tile.Explosion)
            {
                S[leftTile] = 0;
                T[leftTile] = Tile.Space;
            }
            decreaseRemainingRedDisksIfNeeded(position - 1);
            return position;
        }
        else if (previousMurphyMovingObject == 34)
        {
            if (T[belowTile] != Tile.Explosion)
            {
                S[belowTile] = 0;
                T[belowTile] = Tile.Space;
            }
            decreaseRemainingRedDisksIfNeeded(position + kLevelWidth);
            return position;
        }
        else if (previousMurphyMovingObject == 35)
        {
            if (T[rightTile] != Tile.Explosion)
            {
                S[rightTile] = 0;
                T[rightTile] = Tile.Space;
            }
            decreaseRemainingRedDisksIfNeeded(position + 1);
            return position;
        }
        else if (previousMurphyMovingObject == 36)
        {
            if (T[murphyTile] != Tile.Explosion)
            {
                S[murphyTile] = 0;
                T[murphyTile] = Tile.Space;
            }
            S[aboveTile] = 0;
            T[aboveTile] = Tile.Murphy;
            S[aboveAboveTile] = 0;
            T[aboveAboveTile] = Tile.YellowDisk;
            return position - kLevelWidth;
        }
        else if (previousMurphyMovingObject == 37)
        {
            if (T[murphyTile] != Tile.Explosion)
            {
                S[murphyTile] = 0;
                T[murphyTile] = Tile.Space;
            }
            S[leftTile] = 0;
            T[leftTile] = Tile.Murphy;
            S[leftLeftTile] = 0;
            T[leftLeftTile] = Tile.YellowDisk;
            return position - 1;
        }
        else if (previousMurphyMovingObject == 39)
        {
            if (T[murphyTile] != Tile.Explosion)
            {
                S[murphyTile] = 0;
                T[murphyTile] = Tile.Space;
            }
            S[belowTile] = 0;
            T[belowTile] = Tile.Murphy;
            S[belowBelowTile] = 0;
            T[belowBelowTile] = Tile.YellowDisk;
            return position + kLevelWidth;
        }
        else if (previousMurphyMovingObject == 38)
        {
            if (T[murphyTile] != Tile.Explosion)
            {
                S[murphyTile] = 0;
                T[murphyTile] = Tile.Space;
            }
            S[rightTile] = 0;
            T[rightTile] = Tile.Murphy;
            S[rightRightTile] = 0;
            T[rightRightTile] = Tile.YellowDisk;
            return position + 1;
        }
        else if (previousMurphyMovingObject == 40)
        {
            if (T[murphyTile] != Tile.Explosion)
            {
                S[murphyTile] = 0;
                T[murphyTile] = Tile.Space;
            }
            S[leftTile] = 0;
            T[leftTile] = Tile.Murphy;
            S[leftLeftTile] = 0;
            T[leftLeftTile] = Tile.OrangeDisk;
            return position - 1;
        }
        else if (previousMurphyMovingObject == 41)
        {
            if (T[murphyTile] != Tile.Explosion)
            {
                S[murphyTile] = 0;
                T[murphyTile] = Tile.Space;
            }
            S[rightTile] = 0;
            T[rightTile] = Tile.Murphy;
            S[rightRightTile] = 0;
            T[rightRightTile] = Tile.OrangeDisk;
            if (S[belowRightRightTile] == 0 && T[belowRightRightTile] == Tile.Space)
            {
                S[rightRightTile] = 0x20;
                S[belowRightRightTile] = 8;
            }
            return position + 1;
        }
        else if (previousMurphyMovingObject == 42)
        {
            S[murphyTile] = 0;
            T[murphyTile] = Tile.Murphy;
            gPlantedRedDiskCountdown = u8(2);
            gNumberOfRemainingRedDisks = u8(gNumberOfRemainingRedDisks - 1);
            drawNumberOfRemainingRedDisks();
            playPushSound();
            return position;
        }
        else
        {
            gShouldExitLevel = 1;
            return position;
        }
    }
    gMurphyCounterToStartPushAnimation = u8(gMurphyCounterToStartPushAnimation - 1);
    if (gMurphyCounterToStartPushAnimation == 0)
    {
        playPushSound();
    }
    if (S[murphyTile] == 0xE)
    {
        if (gCurrentUserInput == Input.Left && (S[leftTile] == 0 && T[leftTile] == Tile.Zonk))
        {
            return position;
        }
        S[murphyTile] = 0;
        T[murphyTile] = Tile.Murphy;
        S[leftTile] = 0;
        T[leftTile] = Tile.Zonk;
        if (T[leftLeftTile] != Tile.Explosion)
        {
            S[leftLeftTile] = 0;
            T[leftLeftTile] = Tile.Space;
        }
        drawMovingFrame(304, 132, position);
        return position;
    }
    else if (S[murphyTile] == 0xF)
    {
        if (gCurrentUserInput == Input.Right && (S[rightTile] == 0 && T[rightTile] == Tile.Zonk))
        {
            return position;
        }
        S[murphyTile] = 0;
        T[murphyTile] = Tile.Murphy;
        S[rightTile] = 0;
        T[rightTile] = Tile.Zonk;
        if (T[rightRightTile] != Tile.Explosion)
        {
            S[rightRightTile] = 0;
            T[rightRightTile] = Tile.Space;
        }
        drawMovingFrame(304, 132, position);
        return position;
    }
    else if (S[murphyTile] == 0x28)
    {
        if (gCurrentUserInput == Input.Left && (S[leftTile] == 0 && T[leftTile] == Tile.OrangeDisk))
        {
            return position;
        }
        S[murphyTile] = 0;
        T[murphyTile] = Tile.Murphy;
        S[leftTile] = 0;
        T[leftTile] = Tile.OrangeDisk;
        if (T[leftLeftTile] != Tile.Explosion)
        {
            S[leftLeftTile] = 0;
            T[leftLeftTile] = Tile.Space;
        }
        drawMovingFrame(304, 132, position);
        return position;
    }
    else if (S[murphyTile] == 0x29)
    {
        if (gCurrentUserInput == Input.Right && (S[rightTile] == 0 && T[rightTile] == Tile.OrangeDisk))
        {
            return position;
        }
        S[murphyTile] = 0;
        T[murphyTile] = Tile.Murphy;
        S[rightTile] = 0;
        T[rightTile] = Tile.OrangeDisk;
        if (T[rightRightTile] != Tile.Explosion)
        {
            S[rightRightTile] = 0;
            T[rightRightTile] = Tile.Space;
        }
        drawMovingFrame(304, 132, position);
        return position;
    }
    else if (S[murphyTile] == 0x24)
    {
        if (gCurrentUserInput == Input.Up && (S[aboveTile] == 0 && T[aboveTile] == Tile.YellowDisk))
        {
            return position;
        }
        S[murphyTile] = 0;
        T[murphyTile] = Tile.Murphy;
        S[aboveTile] = 0;
        T[aboveTile] = Tile.YellowDisk;
        if (T[aboveAboveTile] != Tile.Explosion)
        {
            S[aboveAboveTile] = 0;
            T[aboveAboveTile] = Tile.Space;
        }
        drawMovingFrame(304, 132, position);
        return position;
    }
    else if (S[murphyTile] == 0x25)
    {
        if (gCurrentUserInput == Input.Left && (S[leftTile] == 0 && T[leftTile] == Tile.YellowDisk))
        {
            return position;
        }
        S[murphyTile] = 0;
        T[murphyTile] = Tile.Murphy;
        S[leftTile] = 0;
        T[leftTile] = Tile.YellowDisk;
        if (T[leftLeftTile] != Tile.Explosion)
        {
            S[leftLeftTile] = 0;
            T[leftLeftTile] = Tile.Space;
        }
        drawMovingFrame(304, 132, position);
        return position;
    }
    else if (S[murphyTile] == 0x27)
    {
        if (gCurrentUserInput == Input.Down && (S[belowTile] == 0 && T[belowTile] == Tile.YellowDisk))
        {
            return position;
        }
        S[murphyTile] = 0;
        T[murphyTile] = Tile.Murphy;
        S[belowTile] = 0;
        T[belowTile] = Tile.YellowDisk;
        if (T[belowBelowTile] != Tile.Explosion)
        {
            S[belowBelowTile] = 0;
            T[belowBelowTile] = Tile.Space;
        }
        drawMovingFrame(304, 132, position);
        return position;
    }
    else if (S[murphyTile] == 0x26)
    {
        if (gCurrentUserInput == Input.Right && (S[rightTile] == 0 && T[rightTile] == Tile.YellowDisk))
        {
            return position;
        }
        S[murphyTile] = 0;
        T[murphyTile] = Tile.Murphy;
        S[rightTile] = 0;
        T[rightTile] = Tile.YellowDisk;
        if (T[rightRightTile] != Tile.Explosion)
        {
            S[rightRightTile] = 0;
            T[rightRightTile] = Tile.Space;
        }
        drawMovingFrame(304, 132, position);
        return position;
    }
    else if (S[murphyTile] == 0x2A)
    {
        if (gCurrentUserInput == Input.SpaceOnly)
        {
            if (gMurphyCounterToStartPushAnimation > 0x20)
            {
                return position;
            }
            drawMovingFrame(288, 132, position);
            gPlantedRedDiskCountdown = u8(1);
            return position;
        }
        S[murphyTile] = 0;
        T[murphyTile] = Tile.Murphy;
        drawMovingFrame(304, 132, position);
        gPlantedRedDiskCountdown = u8(0);
        return position;
    }
    else
    {
        return position;
    }
}
function detonateYellowDisks(): void
{
    gTerminalMaxFramesToNextScroll = 7;
    gAreYellowDisksDetonated = 1;
    for (let i = 0; i < kLevelSize; ++i)
    {
        let tile = i;
        if (S[tile] == 0 && T[tile] == Tile.YellowDisk)
        {
            detonateBigExplosion(i);
        }
    }
}
function handleZonkPushedByMurphy(position: number): void
{
    let belowTile = position + kLevelWidth;
    if (T[belowTile] == Tile.SnikSnak || T[belowTile] == 0xBB)
    {
        detonateBigExplosion(position + kLevelWidth);
    }
}
function checkMurphyMovementToPosition(position: number, userInput: number): number
{
    let tile = position;
    if ((S[tile] == 0xFF && T[tile] == 0xFF) || (S[tile] == 0xAA && T[tile] == 0xAA) || (S[tile] == 0))
    {
        return 1;
    }
    else if (T[tile] == Tile.Zonk)
    {
        if (userInput == Input.Left)
        {
            let stateType = u8((S[tile] & 0xF0));
            if (stateType == 0x20 || stateType == 0x40 || stateType == 0x50 || stateType == 0x70)
            {
                return 1;
            }
            detonateBigExplosion(position);
            return 1;
        }
        else if (userInput != Input.Right)
        {
            detonateBigExplosion(position);
            return 1;
        }
        let stateType = u8((S[tile] & 0xF0));
        if (stateType == 0x30 || stateType == 0x40 || stateType == 0x60 || stateType == 0x70)
        {
            return 1;
        }
        detonateBigExplosion(position);
        return 1;
    }
    else if (T[tile] == Tile.Explosion)
    {
        if ((S[tile] & 0x80) != 0 || S[tile] < 4)
        {
            detonateBigExplosion(position);
            return 1;
        }
        else
        {
            S[tile] = 0;
            T[tile] = Tile.Space;
            return 0;
        }
    }
    else if (T[tile] == Tile.OrangeDisk || T[tile] == Tile.PortRight || T[tile] == Tile.PortDown || T[tile] == Tile.PortLeft || T[tile] == Tile.PortUp)
    {
        return 1;
    }
    else
    {
        detonateBigExplosion(position);
        return 1;
    }
}
function updateSpecialPort(position: number): void
{
    const portInfo = gCurrentLevel.specialPorts.find((p) => p.position == position);
    if (!portInfo)
    {
        return;
    }
    gIsGravityEnabled = portInfo.gravity;
    gAreZonksFrozen = portInfo.freezeZonks;
    gAreEnemiesFrozen = portInfo.freezeEnemies;
}
function updateSnikSnakTiles(position: number): void
{
    if (gAreEnemiesFrozen == 1)
    {
        return;
    }
    let currentTile = position;
    if (T[currentTile] != Tile.SnikSnak)
    {
        return;
    }
    let frame = u8(S[currentTile]);
    let fn = kSnikSnakMovingFunctions[frame];
    if (fn)
    {
        fn(position, frame);
    }
}
function updateSnikSnakTurnLeft(position: number, frame: number): void
{
    let currentTile = position;
    let aboveTile = position - kLevelWidth;
    let leftTile = position - 1;
    let belowTile = position + kLevelWidth;
    let rightTile = position + 1;
    let value = u16(gFrameCounter & 3);
    if (value == 0)
    {
        let frameCoordinates = SNIK_SNAK_FRAMES[frame];
        drawMovingFrame(frameCoordinates[0], frameCoordinates[1], position);
        frame = u8(frame + 1);
        frame = u8(frame & (7));
        S[currentTile] = frame;
        return;
    }
    else if (value != 3)
    {
        return;
    }
    let state = u8(S[currentTile]);
    let nextMovingObject = u8(0);
    if (state == 0)
    {
        if (S[aboveTile] == 0 && T[aboveTile] == Tile.Space)
        {
            S[currentTile] = 0x1;
            T[currentTile] = 0xBB;
            S[aboveTile] = 0x10;
            T[aboveTile] = Tile.SnikSnak;
            return;
        }
        nextMovingObject = u8(S[aboveTile]);
        if (T[aboveTile] != Tile.Murphy)
        {
            return;
        }
    }
    else if (state == 2)
    {
        if (S[leftTile] == 0 && T[leftTile] == Tile.Space)
        {
            S[currentTile] = 0x2;
            T[currentTile] = 0xBB;
            S[leftTile] = 0x18;
            T[leftTile] = Tile.SnikSnak;
            return;
        }
        nextMovingObject = u8(S[leftTile]);
        if (T[leftTile] != Tile.Murphy)
        {
            return;
        }
    }
    else if (state == 4)
    {
        if (S[belowTile] == 0 && T[belowTile] == Tile.Space)
        {
            S[currentTile] = 0x3;
            T[currentTile] = 0xBB;
            S[belowTile] = 0x20;
            T[belowTile] = Tile.SnikSnak;
            return;
        }
        nextMovingObject = u8(S[belowTile]);
        if (T[belowTile] != Tile.Murphy)
        {
            return;
        }
    }
    else if (state == 6)
    {
        if (S[rightTile] == 0 && T[rightTile] == Tile.Space)
        {
            S[currentTile] = 0x4;
            T[currentTile] = 0xBB;
            S[rightTile] = 0x28;
            T[rightTile] = Tile.SnikSnak;
            return;
        }
        nextMovingObject = u8(S[rightTile]);
        if (T[rightTile] != Tile.Murphy)
        {
            return;
        }
    }
    else
    {
        return;
    }
    if (nextMovingObject != 0x1B && nextMovingObject != 0x19 && nextMovingObject != 0x18 && nextMovingObject != 0x1A)
    {
        detonateBigExplosion(position);
    }
}
function updateSnikSnakTurnRight(position: number, frame: number): void
{
    let currentTile = position;
    let aboveTile = position - kLevelWidth;
    let rightTile = position + 1;
    let leftTile = position - 1;
    let belowTile = position + kLevelWidth;
    let value = u16(gFrameCounter & 3);
    if (value == 0)
    {
        let frameCoordinates = SNIK_SNAK_FRAMES[frame];
        drawMovingFrame(frameCoordinates[0], frameCoordinates[1], position);
        frame = u8(frame + 1);
        frame = u8(frame & (7));
        frame = u8(frame | (8));
        S[currentTile] = frame;
        return;
    }
    else if (value != 3)
    {
        return;
    }
    let state = u8(S[currentTile]);
    let nextMovingObject = u8(0);
    if (state == 8)
    {
        if (S[aboveTile] == 0 && T[aboveTile] == Tile.Space)
        {
            S[currentTile] = 0x1;
            T[currentTile] = 0xBB;
            S[aboveTile] = 0x10;
            T[aboveTile] = Tile.SnikSnak;
            return;
        }
        nextMovingObject = u8(S[aboveTile]);
        if (T[aboveTile] != Tile.Murphy)
        {
            return;
        }
    }
    else if (state == 0xA)
    {
        if (S[rightTile] == 0 && T[rightTile] == Tile.Space)
        {
            S[currentTile] = 0x4;
            T[currentTile] = 0xBB;
            S[rightTile] = 0x28;
            T[rightTile] = Tile.SnikSnak;
            return;
        }
        nextMovingObject = u8(S[rightTile]);
        if (T[rightTile] != Tile.Murphy)
        {
            return;
        }
    }
    else if (state == 0xC)
    {
        if (S[belowTile] == 0 && T[belowTile] == Tile.Space)
        {
            S[currentTile] = 0x3;
            T[currentTile] = 0xBB;
            S[belowTile] = 0x20;
            T[belowTile] = Tile.SnikSnak;
            return;
        }
        nextMovingObject = u8(S[belowTile]);
        if (T[belowTile] != Tile.Murphy)
        {
            return;
        }
    }
    else if (state == 0xE)
    {
        if (S[leftTile] == 0 && T[leftTile] == Tile.Space)
        {
            S[currentTile] = 0x2;
            T[currentTile] = 0xBB;
            S[leftTile] = 0x18;
            T[leftTile] = Tile.SnikSnak;
            return;
        }
        nextMovingObject = u8(S[leftTile]);
        if (T[leftTile] != Tile.Murphy)
        {
            return;
        }
    }
    else
    {
        return;
    }
    if (nextMovingObject != 0x1B && nextMovingObject != 0x19 && nextMovingObject != 0x18 && nextMovingObject != 0x1A)
    {
        detonateBigExplosion(position);
    }
}
function updateSnikSnakMovementUp(position: number, frame: number): void
{
    let currentTile = position;
    let belowTile = position + kLevelWidth;
    let leftTile = position - 1;
    let aboveTile = position - kLevelWidth;
    let rightTile = position + 1;
    let finalPosition = u16(position + kLevelWidth);
    let frameCoordinates = SNIK_SNAK_FRAMES[frame];
    frame = u8(frame - (15));
    let offset = u16(kFallAnimationGravityOffsets[frame]);
    let tileX = u8((finalPosition % kLevelWidth));
    let tileY = u8((idiv(finalPosition, kLevelWidth)));
    let dstX = u16(tileX * kTileSize - (offset % 122) * 2);
    let dstY = u16(tileY * kTileSize - (idiv(offset, 122)) * 2);
    drawMovingSpriteFrameInLevel(frameCoordinates[0], frameCoordinates[1],
                                 kTileSize,
                                 kTileSize + 2,
                                 dstX, dstY);
    if (frame == 7)
    {
        if (T[belowTile] != Tile.Explosion)
        {
            S[belowTile] = 0;
            T[belowTile] = Tile.Space;
        }
    }
    if (frame < 8)
    {
        frame = u8(frame + (0x10));
        S[currentTile] = frame;
        return;
    }
    S[currentTile] = 0;
    T[currentTile] = Tile.SnikSnak;
    if (S[leftTile] == 0 && T[leftTile] == Tile.Space)
    {
        S[currentTile] = 1;
        return;
    }
    if (T[leftTile] == Tile.Murphy)
    {
        S[currentTile] = 1;
        return;
    }
    if (S[aboveTile] == 0 && T[aboveTile] == Tile.Space)
    {
        S[currentTile] = 1;
        T[currentTile] = 0xBB;
        S[aboveTile] = 0x10;
        T[aboveTile] = Tile.SnikSnak;
        return;
    }
    if (T[aboveTile] == Tile.Murphy)
    {
        detonateBigExplosion(position);
        return;
    }
    if (S[rightTile] == 0 && T[rightTile] == Tile.Space)
    {
        S[currentTile] = 9;
        return;
    }
    if (T[rightTile] == Tile.Murphy)
    {
        S[currentTile] = 9;
        return;
    }
    S[currentTile] = 1;
}
function updateSnikSnakMovementLeft(position: number, frame: number): void
{
    let currentTile = position;
    let belowTile = position + kLevelWidth;
    let leftTile = position - 1;
    let aboveTile = position - kLevelWidth;
    let rightTile = position + 1;
    let frameCoordinates = SNIK_SNAK_FRAMES[frame];
    let tileX = u8((position % kLevelWidth));
    let tileY = u8((idiv(position, kLevelWidth)));
    let dstX = u16(tileX * kTileSize);
    let dstY = u16(tileY * kTileSize);
    drawMovingSpriteFrameInLevel(frameCoordinates[0], frameCoordinates[1],
                                 kTileSize * 2,
                                 kTileSize,
                                 dstX, dstY);
    frame = u8(frame & (7));
    frame = u8(frame + 1);
    if (frame == 7)
    {
        if (T[rightTile] != Tile.Explosion)
        {
            S[rightTile] = 0;
            T[rightTile] = Tile.Space;
        }
    }
    if (frame < 8)
    {
        frame = u8(frame + (0x18));
        S[currentTile] = frame;
        return;
    }
    S[currentTile] = 0;
    T[currentTile] = Tile.SnikSnak;
    if (S[belowTile] == 0 && T[belowTile] == Tile.Space)
    {
        S[currentTile] = 3;
        return;
    }
    if (T[belowTile] == Tile.Murphy)
    {
        S[currentTile] = 3;
        return;
    }
    if (S[leftTile] == 0 && T[leftTile] == Tile.Space)
    {
        S[currentTile] = 2;
        T[currentTile] = 0xBB;
        S[leftTile] = 0x18;
        T[leftTile] = Tile.SnikSnak;
        return;
    }
    if (T[leftTile] == Tile.Murphy)
    {
        detonateBigExplosion(position);
        return;
    }
    if (S[aboveTile] == 0 && T[aboveTile] == Tile.Space)
    {
        S[currentTile] = 0xF;
        return;
    }
    if (T[aboveTile] == Tile.Murphy)
    {
        S[currentTile] = 0xF;
        return;
    }
    S[currentTile] = 3;
}
function updateSnikSnakMovementDown(position: number, frame: number): void
{
    let currentTile = position;
    let belowTile = position + kLevelWidth;
    let leftTile = position - 1;
    let aboveTile = position - kLevelWidth;
    let rightTile = position + 1;
    let finalPosition = u16(position - kLevelWidth);
    let frameCoordinates = SNIK_SNAK_FRAMES[frame];
    frame = u8(frame - (0x20));
    let offset = u16(kFallAnimationGravityOffsets[frame]);
    let tileX = u8((finalPosition % kLevelWidth));
    let tileY = u8((idiv(finalPosition, kLevelWidth)));
    let dstX = u16(tileX * kTileSize + (offset % 122) * 2);
    let dstY = u16(tileY * kTileSize + (idiv(offset, 122)) * 2);
    drawMovingSpriteFrameInLevel(frameCoordinates[0], frameCoordinates[1],
                                 kTileSize,
                                 kTileSize + 2,
                                 dstX, dstY);
    frame = u8(frame + 1);
    if (frame == 7)
    {
        if (T[aboveTile] != Tile.Explosion)
        {
            S[aboveTile] = 0;
            T[aboveTile] = Tile.Space;
        }
    }
    if (frame < 8)
    {
        frame = u8(frame + (0x20));
        S[currentTile] = frame;
        return;
    }
    S[currentTile] = 0;
    T[currentTile] = Tile.SnikSnak;
    if (S[rightTile] == 0 && T[rightTile] == Tile.Space)
    {
        S[currentTile] = 5;
        return;
    }
    if (T[rightTile] == Tile.Murphy)
    {
        S[currentTile] = 5;
        return;
    }
    if (S[belowTile] == 0 && T[belowTile] == Tile.Space)
    {
        S[currentTile] = 3;
        T[currentTile] = 0xBB;
        S[belowTile] = 0x20;
        T[belowTile] = Tile.SnikSnak;
        return;
    }
    if (T[belowTile] == Tile.Murphy)
    {
        detonateBigExplosion(position);
        return;
    }
    if (S[leftTile] == 0 && T[leftTile] == Tile.Space)
    {
        S[currentTile] = 0xD;
        return;
    }
    if (T[leftTile] == Tile.Murphy)
    {
        S[currentTile] = 0xD;
        return;
    }
    S[currentTile] = 5;
}
function updateSnikSnakMovementRight(position: number, frame: number): void
{
    let currentTile = position;
    let belowTile = position + kLevelWidth;
    let leftTile = position - 1;
    let aboveTile = position - kLevelWidth;
    let rightTile = position + 1;
    let frameCoordinates = SNIK_SNAK_FRAMES[frame];
    let finalPosition = u16(position - 1);
    let tileX = u8((finalPosition % kLevelWidth));
    let tileY = u8((idiv(finalPosition, kLevelWidth)));
    let dstX = u16(tileX * kTileSize);
    let dstY = u16(tileY * kTileSize);
    drawMovingSpriteFrameInLevel(frameCoordinates[0], frameCoordinates[1],
                                 kTileSize * 2,
                                 kTileSize,
                                 dstX, dstY);
    frame = u8(frame & (7));
    frame = u8(frame + 1);
    if (frame == 7)
    {
        if (T[leftTile] != Tile.Explosion)
        {
            S[leftTile] = 0;
            T[leftTile] = Tile.Space;
        }
    }
    if (frame < 8)
    {
        frame = u8(frame + (0x28));
        S[currentTile] = frame;
        return;
    }
    S[currentTile] = 0;
    T[currentTile] = Tile.SnikSnak;
    if (S[aboveTile] == 0 && T[aboveTile] == Tile.Space)
    {
        S[currentTile] = 7;
        return;
    }
    if (T[aboveTile] == Tile.Murphy)
    {
        S[currentTile] = 7;
        return;
    }
    if (S[rightTile] == 0 && T[rightTile] == Tile.Space)
    {
        S[currentTile] = 4;
        T[currentTile] = 0xBB;
        S[rightTile] = 0x28;
        T[rightTile] = Tile.SnikSnak;
        return;
    }
    if (T[rightTile] == Tile.Murphy)
    {
        detonateBigExplosion(position);
        return;
    }
    if (S[belowTile] == 0 && T[belowTile] == Tile.Space)
    {
        S[currentTile] = 0xB;
        return;
    }
    if (T[belowTile] == Tile.Murphy)
    {
        S[currentTile] = 0xB;
        return;
    }
    S[currentTile] = 7;
}
function updateElectronTiles(position: number): void
{
    if (gAreEnemiesFrozen == 1)
    {
        return;
    }
    let currentTile = position;
    if (T[currentTile] != Tile.Electron)
    {
        return;
    }
    let frame = u8(S[currentTile]);
    let fn = kElectronMovingFunctions[frame];
    if (fn)
    {
        fn(position, frame);
    }
}
function updateElectronTurnLeft(position: number, frame: number): void
{
    let currentTile = position;
    let aboveTile = position - kLevelWidth;
    let leftTile = position - 1;
    let belowTile = position + kLevelWidth;
    let rightTile = position + 1;
    let value = u16(gFrameCounter & 3);
    if (value == 0)
    {
        let frameCoordinates = ELECTRON_FRAMES[frame];
        drawMovingFrame(frameCoordinates[0], frameCoordinates[1], position);
        frame = u8(frame + 1);
        frame = u8(frame & (7));
        S[currentTile] = frame;
        return;
    }
    else if (value != 3)
    {
        return;
    }
    let state = u8(S[currentTile]);
    if (state == 0)
    {
        if (S[aboveTile] == 0 && T[aboveTile] == Tile.Space)
        {
            S[currentTile] = 0x1;
            T[currentTile] = 0xBB;
            S[aboveTile] = 0x10;
            T[aboveTile] = Tile.Electron;
            return;
        }
        else if (T[aboveTile] != Tile.Murphy)
        {
            return;
        }
    }
    else if (state == 2)
    {
        if (S[leftTile] == 0 && T[leftTile] == Tile.Space)
        {
            S[currentTile] = 0x2;
            T[currentTile] = 0xBB;
            S[leftTile] = 0x18;
            T[leftTile] = Tile.Electron;
            return;
        }
        else if (T[leftTile] != Tile.Murphy)
        {
            return;
        }
    }
    else if (state == 4)
    {
        if (S[belowTile] == 0 && T[belowTile] == Tile.Space)
        {
            S[currentTile] = 0x3;
            T[currentTile] = 0xBB;
            S[belowTile] = 0x20;
            T[belowTile] = Tile.Electron;
            return;
        }
        else if (T[belowTile] != Tile.Murphy)
        {
            return;
        }
    }
    else if (state == 6)
    {
        if (S[rightTile] == 0 && T[rightTile] == Tile.Space)
        {
            S[currentTile] = 0x4;
            T[currentTile] = 0xBB;
            S[rightTile] = 0x28;
            T[rightTile] = Tile.Electron;
            return;
        }
        else if (T[rightTile] != Tile.Murphy)
        {
            return;
        }
    }
    else
    {
        return;
    }
    detonateBigExplosion(position);
}
function updateElectronTurnRight(position: number, frame: number): void
{
    let currentTile = position;
    let aboveTile = position - kLevelWidth;
    let leftTile = position - 1;
    let belowTile = position + kLevelWidth;
    let rightTile = position + 1;
    let value = u16(gFrameCounter & 3);
    if (value == 0)
    {
        let frameCoordinates = ELECTRON_FRAMES[frame];
        drawMovingFrame(frameCoordinates[0], frameCoordinates[1], position);
        frame = u8(frame + 1);
        frame = u8(frame & (7));
        frame = u8(frame | (8));
        S[currentTile] = frame;
        return;
    }
    else if (value != 3)
    {
        return;
    }
    let state = u8(S[currentTile]);
    if (state == 8)
    {
        if (S[aboveTile] == 0 && T[aboveTile] == Tile.Space)
        {
            S[currentTile] = 0x1;
            T[currentTile] = 0xBB;
            S[aboveTile] = 0x10;
            T[aboveTile] = Tile.Electron;
            return;
        }
        else if (T[aboveTile] != Tile.Murphy)
        {
            return;
        }
    }
    else if (state == 0xA)
    {
        if (S[rightTile] == 0 && T[rightTile] == Tile.Space)
        {
            S[currentTile] = 0x4;
            T[currentTile] = 0xBB;
            S[rightTile] = 0x28;
            T[rightTile] = Tile.Electron;
            return;
        }
        else if (T[rightTile] != Tile.Murphy)
        {
            return;
        }
    }
    else if (state == 0xC)
    {
        if (S[belowTile] == 0 && T[belowTile] == Tile.Space)
        {
            S[currentTile] = 0x3;
            T[currentTile] = 0xBB;
            S[belowTile] = 0x20;
            T[belowTile] = Tile.Electron;
            return;
        }
        else if (T[belowTile] != Tile.Murphy)
        {
            return;
        }
    }
    else if (state == 0xE)
    {
        if (S[leftTile] == 0 && T[leftTile] == Tile.Space)
        {
            S[currentTile] = 0x2;
            T[currentTile] = 0xBB;
            S[leftTile] = 0x18;
            T[leftTile] = Tile.Electron;
            return;
        }
        else if (T[leftTile] != Tile.Murphy)
        {
            return;
        }
    }
    else
    {
        return;
    }
    detonateBigExplosion(position);
}
function updateElectronMovementUp(position: number, frame: number): void
{
    let currentTile = position;
    let belowTile = position + kLevelWidth;
    let leftTile = position - 1;
    let aboveTile = position - kLevelWidth;
    let rightTile = position + 1;
    let finalPosition = u16(position + kLevelWidth);
    let frameCoordinates = ELECTRON_FRAMES[frame];
    frame = u8(frame - (15));
    let offset = u16(kFallAnimationGravityOffsets[frame]);
    let tileX = u8((finalPosition % kLevelWidth));
    let tileY = u8((idiv(finalPosition, kLevelWidth)));
    let dstX = u16(tileX * kTileSize - (offset % 122) * 2);
    let dstY = u16(tileY * kTileSize - (idiv(offset, 122)) * 2);
    drawMovingSpriteFrameInLevel(frameCoordinates[0], frameCoordinates[1],
                                 kTileSize,
                                 kTileSize + 2,
                                 dstX, dstY);
    if (frame == 7)
    {
        if (T[belowTile] != Tile.Explosion)
        {
            S[belowTile] = 0;
            T[belowTile] = Tile.Space;
        }
    }
    if (frame < 8)
    {
        frame = u8(frame + (0x10));
        S[currentTile] = frame;
        return;
    }
    S[currentTile] = 0;
    T[currentTile] = Tile.Electron;
    if (S[leftTile] == 0 && T[leftTile] == Tile.Space)
    {
        S[currentTile] = 1;
        return;
    }
    if (T[leftTile] == Tile.Murphy)
    {
        S[currentTile] = 1;
        return;
    }
    if (S[aboveTile] == 0 && T[aboveTile] == Tile.Space)
    {
        S[currentTile] = 1;
        T[currentTile] = 0xBB;
        S[aboveTile] = 0x10;
        T[aboveTile] = Tile.Electron;
        return;
    }
    if (T[aboveTile] == Tile.Murphy)
    {
        detonateBigExplosion(position);
        return;
    }
    if (S[rightTile] == 0 && T[rightTile] == Tile.Space)
    {
        S[currentTile] = 9;
        return;
    }
    if (T[rightTile] == Tile.Murphy)
    {
        S[currentTile] = 9;
        return;
    }
    S[currentTile] = 1;
}
function updateElectronMovementDown(position: number, frame: number): void
{
    let currentTile = position;
    let belowTile = position + kLevelWidth;
    let leftTile = position - 1;
    let aboveTile = position - kLevelWidth;
    let rightTile = position + 1;
    let frameCoordinates = ELECTRON_FRAMES[frame];
    let tileX = u8((position % kLevelWidth));
    let tileY = u8((idiv(position, kLevelWidth)));
    let dstX = u16(tileX * kTileSize);
    let dstY = u16(tileY * kTileSize);
    drawMovingSpriteFrameInLevel(frameCoordinates[0], frameCoordinates[1],
                                 kTileSize * 2,
                                 kTileSize,
                                 dstX, dstY);
    frame = u8(frame & (7));
    frame = u8(frame + 1);
    if (frame == 7)
    {
        if (T[rightTile] != Tile.Explosion)
        {
            S[rightTile] = 0;
            T[rightTile] = Tile.Space;
        }
    }
    if (frame < 8)
    {
        frame = u8(frame + (0x18));
        S[currentTile] = frame;
        return;
    }
    S[currentTile] = 0;
    T[currentTile] = Tile.Electron;
    if (S[belowTile] == 0 && T[belowTile] == Tile.Space)
    {
        S[currentTile] = 3;
        return;
    }
    if (T[belowTile] == Tile.Murphy)
    {
        S[currentTile] = 3;
        return;
    }
    if (S[leftTile] == 0 && T[leftTile] == Tile.Space)
    {
        S[currentTile] = 2;
        T[currentTile] = 0xBB;
        S[leftTile] = 0x18;
        T[leftTile] = Tile.Electron;
        return;
    }
    if (T[leftTile] == Tile.Murphy)
    {
        detonateBigExplosion(position);
        return;
    }
    if (S[aboveTile] == 0 && T[aboveTile] == Tile.Space)
    {
        S[currentTile] = 0xF;
        return;
    }
    if (T[aboveTile] == Tile.Murphy)
    {
        S[currentTile] = 0xF;
        return;
    }
    S[currentTile] = 3;
}
function updateElectronMovementRight(position: number, frame: number): void
{
    let currentTile = position;
    let belowTile = position + kLevelWidth;
    let leftTile = position - 1;
    let aboveTile = position - kLevelWidth;
    let rightTile = position + 1;
    let finalPosition = u16(position - kLevelWidth);
    let frameCoordinates = ELECTRON_FRAMES[frame];
    frame = u8(frame - (0x20));
    let offset = u16(kFallAnimationGravityOffsets[frame]);
    let tileX = u8((finalPosition % kLevelWidth));
    let tileY = u8((idiv(finalPosition, kLevelWidth)));
    let dstX = u16(tileX * kTileSize + (offset % 122) * 2);
    let dstY = u16(tileY * kTileSize + (idiv(offset, 122)) * 2);
    drawMovingSpriteFrameInLevel(frameCoordinates[0], frameCoordinates[1],
                                 kTileSize,
                                 kTileSize + 2,
                                 dstX, dstY);
    frame = u8(frame + 1);
    if (frame == 7)
    {
        if (T[aboveTile] != Tile.Explosion)
        {
            S[aboveTile] = 0;
            T[aboveTile] = Tile.Space;
        }
    }
    if (frame < 8)
    {
        frame = u8(frame + (0x20));
        S[currentTile] = frame;
        return;
    }
    S[currentTile] = 0;
    T[currentTile] = Tile.Electron;
    if (S[rightTile] == 0 && T[rightTile] == Tile.Space)
    {
        S[currentTile] = 5;
        return;
    }
    if (T[rightTile] == Tile.Murphy)
    {
        S[currentTile] = 5;
        return;
    }
    if (S[belowTile] == 0 && T[belowTile] == Tile.Space)
    {
        S[currentTile] = 3;
        T[currentTile] = 0xBB;
        S[belowTile] = 0x20;
        T[belowTile] = Tile.Electron;
        return;
    }
    if (T[belowTile] == Tile.Murphy)
    {
        detonateBigExplosion(position);
        return;
    }
    if (S[leftTile] == 0 && T[leftTile] == Tile.Space)
    {
        S[currentTile] = 0xD;
        return;
    }
    if (T[leftTile] == Tile.Murphy)
    {
        S[currentTile] = 0xD;
        return;
    }
    S[currentTile] = 5;
}
function updateElectronMovementLeft(position: number, frame: number): void
{
    let currentTile = position;
    let belowTile = position + kLevelWidth;
    let leftTile = position - 1;
    let aboveTile = position - kLevelWidth;
    let rightTile = position + 1;
    let frameCoordinates = ELECTRON_FRAMES[frame];
    let finalPosition = u16(position - 1);
    let tileX = u8((finalPosition % kLevelWidth));
    let tileY = u8((idiv(finalPosition, kLevelWidth)));
    let dstX = u16(tileX * kTileSize);
    let dstY = u16(tileY * kTileSize);
    drawMovingSpriteFrameInLevel(frameCoordinates[0], frameCoordinates[1],
                                 kTileSize * 2,
                                 kTileSize,
                                 dstX, dstY);
    frame = u8(frame & (7));
    frame = u8(frame + 1);
    if (frame == 7)
    {
        if (T[leftTile] != Tile.Explosion)
        {
            S[leftTile] = 0;
            T[leftTile] = Tile.Space;
        }
    }
    if (frame < 8)
    {
        frame = u8(frame + (0x28));
        S[currentTile] = frame;
        return;
    }
    S[currentTile] = 0;
    T[currentTile] = Tile.Electron;
    if (S[aboveTile] == 0 && T[aboveTile] == Tile.Space)
    {
        S[currentTile] = 7;
        return;
    }
    if (T[aboveTile] == Tile.Murphy)
    {
        S[currentTile] = 7;
        return;
    }
    if (S[rightTile] == 0 && T[rightTile] == Tile.Space)
    {
        S[currentTile] = 4;
        T[currentTile] = 0xBB;
        S[rightTile] = 0x28;
        T[rightTile] = Tile.Electron;
        return;
    }
    if (T[rightTile] == Tile.Murphy)
    {
        detonateBigExplosion(position);
        return;
    }
    if (S[belowTile] == 0 && T[belowTile] == Tile.Space)
    {
        S[currentTile] = 0xB;
        return;
    }
    if (T[belowTile] == Tile.Murphy)
    {
        S[currentTile] = 0xB;
        return;
    }
    S[currentTile] = 7;
}
function decreaseRemainingRedDisksIfNeeded(position: number): void
{
    if (gPlantedRedDiskCountdown != 0 && gPlantedRedDiskPosition == position)
    {
        return;
    }
    gNumberOfRemainingRedDisks = u8(gNumberOfRemainingRedDisks + 1);
    drawNumberOfRemainingRedDisks();
}

const movingFunctions: (((position: number) => void) | null)[] = [
    null, updateZonkTiles, null, null, updateInfotronTiles, null, null, null,
    updateOrangeDiskTiles, null, null, null, null, null, null, null,
    null, updateSnikSnakTiles, null, updateTerminalTiles, null, null, null, null,
    updateElectronTiles, updateBugTiles, null, null, null, null, null, updateExplosionTiles,
];
const kSnikSnakMovingFunctions: ((position: number, frame: number) => void)[] = [
    updateSnikSnakTurnLeft, updateSnikSnakTurnLeft, updateSnikSnakTurnLeft, updateSnikSnakTurnLeft, updateSnikSnakTurnLeft, updateSnikSnakTurnLeft, updateSnikSnakTurnLeft, updateSnikSnakTurnLeft, updateSnikSnakTurnRight, updateSnikSnakTurnRight, updateSnikSnakTurnRight, updateSnikSnakTurnRight, updateSnikSnakTurnRight, updateSnikSnakTurnRight, updateSnikSnakTurnRight, updateSnikSnakTurnRight, updateSnikSnakMovementUp, updateSnikSnakMovementUp, updateSnikSnakMovementUp, updateSnikSnakMovementUp, updateSnikSnakMovementUp, updateSnikSnakMovementUp, updateSnikSnakMovementUp, updateSnikSnakMovementUp, updateSnikSnakMovementLeft, updateSnikSnakMovementLeft, updateSnikSnakMovementLeft, updateSnikSnakMovementLeft, updateSnikSnakMovementLeft, updateSnikSnakMovementLeft, updateSnikSnakMovementLeft, updateSnikSnakMovementLeft, updateSnikSnakMovementDown, updateSnikSnakMovementDown, updateSnikSnakMovementDown, updateSnikSnakMovementDown, updateSnikSnakMovementDown, updateSnikSnakMovementDown, updateSnikSnakMovementDown, updateSnikSnakMovementDown, updateSnikSnakMovementRight, updateSnikSnakMovementRight, updateSnikSnakMovementRight, updateSnikSnakMovementRight, updateSnikSnakMovementRight, updateSnikSnakMovementRight, updateSnikSnakMovementRight, updateSnikSnakMovementRight,
];
const kElectronMovingFunctions: ((position: number, frame: number) => void)[] = [
    updateElectronTurnLeft, updateElectronTurnLeft, updateElectronTurnLeft, updateElectronTurnLeft, updateElectronTurnLeft, updateElectronTurnLeft, updateElectronTurnLeft, updateElectronTurnLeft, updateElectronTurnRight, updateElectronTurnRight, updateElectronTurnRight, updateElectronTurnRight, updateElectronTurnRight, updateElectronTurnRight, updateElectronTurnRight, updateElectronTurnRight, updateElectronMovementUp, updateElectronMovementUp, updateElectronMovementUp, updateElectronMovementUp, updateElectronMovementUp, updateElectronMovementUp, updateElectronMovementUp, updateElectronMovementUp, updateElectronMovementDown, updateElectronMovementDown, updateElectronMovementDown, updateElectronMovementDown, updateElectronMovementDown, updateElectronMovementDown, updateElectronMovementDown, updateElectronMovementDown, updateElectronMovementRight, updateElectronMovementRight, updateElectronMovementRight, updateElectronMovementRight, updateElectronMovementRight, updateElectronMovementRight, updateElectronMovementRight, updateElectronMovementRight, updateElectronMovementLeft, updateElectronMovementLeft, updateElectronMovementLeft, updateElectronMovementLeft, updateElectronMovementLeft, updateElectronMovementLeft, updateElectronMovementLeft, updateElectronMovementLeft,
];

// ------------------------------------------------------------------ level start (convertToEasyTiles etc.)

/** Simplifies tile variants and starts enemies moving; returns the number of infotrons. */
function convertToEasyTiles(): number
{
    let numberOfInfotrons = 0;
    for (let i = 0; i < kLevelSize; ++i)
    {
        let currentTile = i;
        if (T[currentTile] == 0xF1)
        {
            T[currentTile] = Tile.Explosion;
            continue;
        }
        if (T[currentTile] == Tile.Infotron)
        {
            numberOfInfotrons++;
            continue;
        }
        const isSnikSnak = S[currentTile] == 0 && T[currentTile] == Tile.SnikSnak;
        const isElectron = S[currentTile] == 0 && T[currentTile] == Tile.Electron;
        if (!isSnikSnak && !isElectron)
        {
            const t = T[currentTile];
            if (S[currentTile] == 0 && (t == Tile.HorizontalChipLeft || t == Tile.HorizontalChipRight || t == Tile.HorizontalChipTop || t == Tile.HorizontalChipBottom))
            {
                T[currentTile] = Tile.Chip;
            }
            else if (S[currentTile] == 0 && t >= Tile.Hardware2 && t <= Tile.Hardware11)
            {
                T[currentTile] = Tile.Hardware;
            }
            else if (S[currentTile] == 0 && t >= Tile.SportRight && t <= Tile.SportUp)
            {
                T[currentTile] -= 4; // special port -> port, state 1 marks it special
                S[currentTile] = 1;
            }
            continue;
        }
        // Enemies start facing a free side: left (stay, state 1), up or right (start moving there).
        const enemy = isSnikSnak ? Tile.SnikSnak : Tile.Electron;
        let leftTile = i - 1;
        let aboveTile = i - kLevelWidth;
        let rightTile = i + 1;
        if (T[leftTile] == Tile.Space && S[leftTile] == 0)
        {
            S[currentTile] = 1;
        }
        else if (T[aboveTile] == Tile.Space && S[aboveTile] == 0)
        {
            S[aboveTile] = 0x10;
            T[aboveTile] = enemy;
            S[currentTile] = 0xFF;
            T[currentTile] = 0xFF;
        }
        else if (T[rightTile] == Tile.Space && S[rightTile] == 0)
        {
            S[rightTile] = 0x28;
            T[rightTile] = enemy;
            S[currentTile] = 0xFF;
            T[currentTile] = 0xFF;
        }
    }
    return numberOfInfotrons;
}

export interface GameStatus {
  infotronsLeft: number;
  infotronsTotal: number;
  redDisks: number;
  explosionStarted: boolean;
  /** Show the red disk count on the panel (after a pickup/drop or Right Shift). */
  showRedDisks: boolean;
  /** Murphy went into the exit (the level counts as won even if it is still running). */
  exitReached: boolean;
  frame: number;
  murphy: number;
  murphyX: number;
  murphyY: number;
  /** Set when the level is over: 'won' after the exit animation, 'lost' after Murphy exploded. */
  result: 'playing' | 'won' | 'lost';
  sounds: SoundId[];
}

let gameOver: GameStatus['result'] = 'playing';

/** Sets up a level like the original's fetchAndInitializeLevel (+ drawFixedLevel). */
export function startLevel(level: LevelData, randomSeed: number): void
{
    gCurrentLevel = level;
    T.set(level.raw);
    S.fill(0);
    gExplosionTimers.fill(0);
    gIsGravityEnabled = level.gravity;
    gAreZonksFrozen = level.freezeZonks;
    drawFixedLevel(T);
    const infotrons = convertToEasyTiles();
    gNumberOfRemainingInfotrons = level.infotronsNeeded != 0 ? level.infotronsNeeded : infotrons & 0xff;
    gTotalNumberOfInfotrons = gNumberOfRemainingInfotrons;
    // initializeGameInfo
    gIsMurphyLookingLeft = 0;
    gShouldKillMurphy = 0;
    gShouldExitLevel = 0;
    gQuitLevelCountdown = 0;
    gNumberOfRemainingRedDisks = 0;
    gMurphyYawnAndSleepCounter = 0;
    gIsExplosionStarted = 0;
    gTerminalMaxFramesToNextScroll = 0x7f;
    gAreYellowDisksDetonated = 0;
    gFrameCounter = 0;
    gAreEnemiesFrozen = 0;
    gIsMurphyGoingThroughPortal = 0;
    gPlantedRedDiskCountdown = 0;
    gPlantedRedDiskPosition = 0;
    gMurphyCounterToStartPushAnimation = 0;
    gPreviousUserInputWasNone = 0;
    gLevelFailed = 1;
    gAdditionalInfoInGamePanelFrameCounter = 0;
    gameOver = 'playing';
    gRandomGeneratorSeed = randomSeed & 0xffff;
    // findMurphy + scrollToMurphy
    gMurphyLocation = 0;
    for (let i = 0; i < kLevelSize; ++i)
    {
        if (level.raw[i] == Tile.Murphy)
        {
            gMurphyLocation = i;
            break;
        }
    }
    gMurphyTileX = gMurphyLocation % kLevelWidth;
    gMurphyTileY = idiv(gMurphyLocation, kLevelWidth);
    gMurphyPositionX = gMurphyTileX * kTileSize;
    gMurphyPositionY = gMurphyTileY * kTileSize;
    drawMovingFrame(304, 132, gMurphyLocation);
    updateScrollOffset();
}

/**
 * One game iteration (35 per second in the original): input, all objects, red disk, explosions.
 * `quit` is the Esc key (Murphy blows up).
 */
export function tick(input: number, quit = false): GameStatus
{
    sounds = [];
    if (gameOver == 'playing')
    {
        gCurrentUserInput = input;
        if (quit && gQuitLevelCountdown <= 0)
        {
            gShouldKillMurphy = 1;
        }
        updateMovingObjects();
        if (gAdditionalInfoInGamePanelFrameCounter != 0)
        {
            gAdditionalInfoInGamePanelFrameCounter--;
        }
        updatePlantedRedDisk();
        updateExplosionTimers();
        updateScrollOffset();
        gFrameCounter = u16(gFrameCounter + 1);
        if (gShouldExitLevel == 1)
        {
            gameOver = gLevelFailed ? 'lost' : 'won';
        }
        else if (gQuitLevelCountdown != 0)
        {
            gQuitLevelCountdown = u16(gQuitLevelCountdown - 1);
            if (gQuitLevelCountdown == 0)
            {
                gameOver = gLevelFailed ? 'lost' : 'won';
            }
        }
    }
    return status();
}

// ------------------------------------------------------------------ camera (updateScrollOffset)

const kScreenWidth = 320;
const kScreenHeight = 200;
const kPanelHeight = 24;
let gScrollOffsetX = 0;
let gScrollOffsetY = 0;
let gShouldShowGamePanel = 1;

/** The original's camera: Murphy centred, clamped, shaking while the level ends. Uses a random number. */
function updateScrollOffset(): void
{
    let randomNumber = 0;
    if (gIsExplosionStarted == 1)
    {
        randomNumber = generateRandomNumber();
    }
    let scrollX = s16(gMurphyPositionX) - kScreenWidth / 2;
    let scrollY = s16(gMurphyPositionY);
    scrollX = Math.max(0, Math.min(scrollX, LEVEL_BITMAP_W - kScreenWidth));
    const viewH = gShouldShowGamePanel ? kScreenHeight - kPanelHeight : kScreenHeight;
    scrollY -= viewH / 2;
    scrollY = Math.max(0, Math.min(scrollY, LEVEL_BITMAP_H - viewH));
    if ((gQuitLevelCountdown & 0xff) != 0)
    {
        randomNumber &= 0x101;
        scrollY += randomNumber >> 8;
        let shakeX = randomNumber & 0xff;
        if (scrollX > 0x13c)
        {
            shakeX = -shakeX;
        }
        scrollX += shakeX;
    }
    gScrollOffsetX = scrollX;
    gScrollOffsetY = scrollY;
}

/** Top-left of the visible part of the level bitmap. */
export function scrollOffset(): { x: number; y: number }
{
    return { x: gScrollOffsetX, y: gScrollOffsetY };
}

/** Panel on/off (Enter in the original) changes the camera's view height. */
export function setPanelVisible(visible: boolean): void
{
    gShouldShowGamePanel = visible ? 1 : 0;
}

/** True when Murphy stands still and will read the next input. */
export function isMurphyIdle(): boolean
{
    return T[gMurphyLocation] == Tile.Murphy && S[gMurphyLocation] == 0;
}

export function status(): GameStatus
{
    return {
        infotronsLeft: gNumberOfRemainingInfotrons,
        infotronsTotal: gTotalNumberOfInfotrons,
        explosionStarted: gIsExplosionStarted != 0,
        showRedDisks: gAdditionalInfoInGamePanelFrameCounter != 0,
        exitReached: gLevelFailed == 0,
        redDisks: gNumberOfRemainingRedDisks,
        frame: gFrameCounter,
        murphy: gMurphyLocation,
        murphyX: gMurphyPositionX,
        murphyY: gMurphyPositionY,
        result: gameOver,
        sounds,
    };
}

/** Right Shift in the original: show the red disk count for a while. */
export function showRedDiskCount(): void
{
    drawNumberOfRemainingRedDisks();
}

/** Is a moving/exploding thing near the screen shaking? (original: shake while quitting) */
export function isQuitting(): boolean
{
    return gQuitLevelCountdown != 0;
}
