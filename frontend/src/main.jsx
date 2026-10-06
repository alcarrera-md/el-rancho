import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import { AlertasProvider } from './context/AlertasContext.jsx';
import { ModulosProvider } from './context/ModulosContext.jsx';
import { FeedbackOperacionProvider } from './context/FeedbackOperacionContext.jsx';
import { aplicarPreferenciasApariencia, obtenerPreferenciasApariencia } from './theme.js';
import './styles.css';
import EstadoPwa from './components/EstadoPwa.jsx';

aplicarPreferenciasApariencia(obtenerPreferenciasApariencia());

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ModulosProvider>
          <AlertasProvider>
            <FeedbackOperacionProvider>
              <App />
              <EstadoPwa />
            </FeedbackOperacionProvider>
          </AlertasProvider>
        </ModulosProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
