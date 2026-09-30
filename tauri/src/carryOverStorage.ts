// Imported first in main.tsx: ES modules run in import order, so this moves
// Voicebox's storage keys before any store module reads its own.
import { carryOverRenamedStorage } from '@/lib/utils/renamedStorage';

carryOverRenamedStorage();
