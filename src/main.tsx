import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, themeMemorise } from './App';
import './ui/theme/global.css';
import './ui/theme/finitions.css';

/*
 * Le thème retenu est posé AVANT le premier rendu. Appliqué seulement par
 * l'application, une fois montée, il laissait voir un instant le thème du
 * système avant de basculer — un éclair blanc à chaque ouverture en sombre.
 */
const themeInitial = themeMemorise();
if (themeInitial !== 'auto') document.documentElement.setAttribute('data-theme', themeInitial);

const racine = document.getElementById('root');
if (!racine) throw new Error('Élément #root introuvable dans index.html');

createRoot(racine).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
