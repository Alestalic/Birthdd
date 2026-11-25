export const AUDIO_TRACK_URL =
  '/assets/aistudio/Joy_Division_-_Disorder__2007_Remaster__e5ad3a95.mp3';

export type CameraPreset = 'side' | 'cover' | 'closeup';

export type SignVariant = 'numeral' | 'greeting' | 'name' | 'wish' | 'love';

export interface GreetingSignConfig {
  id: string;
  text: string;
  /** Playback time in seconds when the sign fades in */
  startAt: number;
  /** Playback time in seconds when the sign fades out (null = stays permanently) */
  endAt: number | null;
  /** Visual styling role */
  variant: SignVariant;
}

export const GREETING_SIGNS: readonly GreetingSignConfig[] = [
  {
    id: 'age-19',
    text: '19',
    startAt: 2.2,
    endAt: 6.2,
    variant: 'numeral',
  },
  {
    id: 'happy-birthday',
    text: 'С днём рождения',
    startAt: 6.8,
    endAt: 11.4,
    variant: 'greeting',
  },
  {
    id: 'shurochka',
    text: 'Шурочка <3',
    startAt: 12.2,
    endAt: 17.4,
    variant: 'name',
  },
  {
    id: 'shine-every-day',
    text: 'Сияй каждый день',
    startAt: 18.5,
    endAt: 24.0,
    variant: 'wish',
  },
  {
    id: 'keep-your-light',
    text: 'Береги свой свет',
    startAt: 25.2,
    endAt: 30.8,
    variant: 'wish',
  },
  {
    id: 'dreams-come-true',
    text: 'Пусть всё сбывается',
    startAt: 32.2,
    endAt: 38.0,
    variant: 'wish',
  },
  {
    id: 'warm-moments',
    text: 'Больше тёплых моментов',
    startAt: 39.5,
    endAt: 45.5,
    variant: 'wish',
  },
  {
    id: 'most-wonderful',
    text: 'Ты — самое прекрасное',
    startAt: 47.0,
    endAt: 53.2,
    variant: 'wish',
  },
  {
    id: 'smile-more',
    text: 'Улыбайся чаще',
    startAt: 55.0,
    endAt: 61.5,
    variant: 'wish',
  },
  {
    id: 'truly-happy',
    text: 'Будь по-настоящему счастлива',
    startAt: 63.5,
    endAt: 70.5,
    variant: 'wish',
  },
  {
    id: 'love-you',
    text: 'Люблю тебя!',
    startAt: 72.5,
    endAt: null,
    variant: 'love',
  },
] as const;

export function getActiveGreetingSign(
  currentTime: number,
): GreetingSignConfig | null {
  for (let i = 0; i < GREETING_SIGNS.length; i++) {
    const sign = GREETING_SIGNS[i];
    if (
      currentTime >= sign.startAt &&
      (sign.endAt === null || currentTime < sign.endAt)
    ) {
      return sign;
    }
  }
  return null;
}

export const CAMERA_PRESETS: readonly {
  id: CameraPreset;
  label: string;
}[] = [
  { id: 'side', label: 'Сбоку' },
  { id: 'cover', label: 'Обложка' },
  { id: 'closeup', label: 'Вблизи' },
] as const;
