import lofiChillUrl from '../../assets/audio/lofi-chill.mp3';
import ambientFlowUrl from '../../assets/audio/ambient-flow.mp3';
import upbeatPulseUrl from '../../assets/audio/upbeat-pulse.mp3';
import cinematicMinimalUrl from '../../assets/audio/cinematic-minimal.mp3';
import retroSynthwaveUrl from '../../assets/audio/retro-synthwave.mp3';
import chillhopStudyUrl from '../../assets/audio/chillhop-study.mp3';
import acousticMorningUrl from '../../assets/audio/acoustic-morning.mp3';
import deepTechMinimalUrl from '../../assets/audio/deep-tech-minimal.mp3';
import sunsetLofiUrl from '../../assets/audio/sunset-lofi.mp3';
import futureGarageUrl from '../../assets/audio/future-garage.mp3';
import corporateInspirationUrl from '../../assets/audio/corporate-inspiration.mp3';
import peacefulMeditationUrl from '../../assets/audio/peaceful-meditation.mp3';
import funkyGrooveUrl from '../../assets/audio/funky-groove.mp3';
import cyberpunkDriveUrl from '../../assets/audio/cyberpunk-drive.mp3';
import pianoReflectionsUrl from '../../assets/audio/piano-reflections.mp3';

export type BundledAudioTrack = {
  id: string;
  name: string;
  genre: string;
  duration: number; // approximate seconds
  url: string;
};

export const BUNDLED_AUDIO_TRACKS: BundledAudioTrack[] = [
  {
    id: 'lofi-chill',
    name: 'Lo-Fi Chill',
    genre: 'Mellow & Warm',
    duration: 12,
    url: lofiChillUrl
  },
  {
    id: 'chillhop-study',
    name: 'Chillhop Study',
    genre: 'Cozy Study Beat',
    duration: 13,
    url: chillhopStudyUrl
  },
  {
    id: 'sunset-lofi',
    name: 'Sunset Lofi',
    genre: 'Golden Hour Chill',
    duration: 14,
    url: sunsetLofiUrl
  },
  {
    id: 'ambient-flow',
    name: 'Ambient Flow',
    genre: 'Atmospheric & Calm',
    duration: 16,
    url: ambientFlowUrl
  },
  {
    id: 'peaceful-meditation',
    name: 'Peaceful Meditation',
    genre: 'Serene & Deep Drone',
    duration: 16,
    url: peacefulMeditationUrl
  },
  {
    id: 'acoustic-morning',
    name: 'Acoustic Morning',
    genre: 'Warm Acoustic Guitar',
    duration: 10,
    url: acousticMorningUrl
  },
  {
    id: 'piano-reflections',
    name: 'Piano Reflections',
    genre: 'Neo-classical & Emotive',
    duration: 11,
    url: pianoReflectionsUrl
  },
  {
    id: 'cinematic-minimal',
    name: 'Cinematic Minimal',
    genre: 'Sleek & Minimal Piano',
    duration: 14,
    url: cinematicMinimalUrl
  },
  {
    id: 'corporate-inspiration',
    name: 'Corporate Inspiration',
    genre: 'Bright, Uplifting & Tech',
    duration: 8,
    url: corporateInspirationUrl
  },
  {
    id: 'upbeat-pulse',
    name: 'Upbeat Pulse',
    genre: 'Energetic Tech House',
    duration: 8,
    url: upbeatPulseUrl
  },
  {
    id: 'deep-tech-minimal',
    name: 'Deep Tech Minimal',
    genre: 'Sub Club & Rolling Sub',
    duration: 8,
    url: deepTechMinimalUrl
  },
  {
    id: 'funky-groove',
    name: 'Funky Groove',
    genre: 'Slap Bass & Upbeat Funk',
    duration: 9,
    url: funkyGrooveUrl
  },
  {
    id: 'future-garage',
    name: 'Future Garage',
    genre: 'Airy 2-Step & Deep Bass',
    duration: 7,
    url: futureGarageUrl
  },
  {
    id: 'retro-synthwave',
    name: 'Retro Synthwave',
    genre: 'Vintage 80s Arpeggio',
    duration: 9,
    url: retroSynthwaveUrl
  },
  {
    id: 'cyberpunk-drive',
    name: 'Cyberpunk Drive',
    genre: 'Gritty Industrial Synth',
    duration: 8,
    url: cyberpunkDriveUrl
  }
];
