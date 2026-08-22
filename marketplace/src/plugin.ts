import streamDeck from '@elgato/streamdeck';
import { SurfaceKeyAction } from './surface-action.js';

streamDeck.logger.setLevel('info');
streamDeck.actions.registerAction(new SurfaceKeyAction());
streamDeck.connect();
