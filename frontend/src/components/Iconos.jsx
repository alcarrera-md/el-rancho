import {
  ArrowLeftRight, Beef, Bell, BookOpen, CalendarDays, ChartNoAxesColumnIncreasing,
  CheckCircle2, CircleDollarSign, Droplet, Eye, Fence, HeartPulse, House, Layers3,
  Leaf, LogOut, MessageCircle, Package, Printer, QrCode, Repeat2, Scale, Search,
  Send, Settings, ShieldPlus, ShoppingCart, Sun, Tag, TrendingUp, UserRound,
  UsersRound, Wind, X, ClipboardList, CloudCog, MapPinned, Route, Stethoscope, Syringe,
} from 'lucide-react';

// Adaptador único para mantener la API histórica del sistema y usar una sola
// familia iconográfica consistente. El color siempre se hereda del contexto.
const crearIcono = (Componente) => function Icono({ width = 18, height = 18, ...props }) {
  return <Componente width={width} height={height} strokeWidth={1.8} aria-hidden="true" {...props} />;
};

export const IconoInicio = crearIcono(House);
export const IconoAnimal = crearIcono(Beef);
export const IconoOjo = crearIcono(Eye);
export const IconoCalendario = crearIcono(CalendarDays);
export const IconoCorral = crearIcono(Fence);
export const IconoPaquete = crearIcono(Package);
export const IconoCapas = crearIcono(Layers3);
export const IconoSalud = crearIcono(ShieldPlus);
export const IconoLista = crearIcono(ClipboardList);
export const IconoPersona = crearIcono(UserRound);
export const IconoPersonas = crearIcono(UsersRound);
export const IconoIntercambio = crearIcono(ArrowLeftRight);
export const IconoEtiqueta = crearIcono(Tag);
export const IconoCarrito = crearIcono(ShoppingCart);
export const IconoTendencia = crearIcono(TrendingUp);
export const IconoReportes = crearIcono(ChartNoAxesColumnIncreasing);
export const IconoCampana = crearIcono(Bell);
export const IconoLibro = crearIcono(BookOpen);
export const IconoEngranaje = crearIcono(Settings);
export const IconoImpresora = crearIcono(Printer);
export const IconoSalir = crearIcono(LogOut);
export const IconoBalanza = crearIcono(Scale);
export const IconoHoja = crearIcono(Leaf);
export const IconoCorazon = crearIcono(HeartPulse);
export const IconoGota = crearIcono(Droplet);
export const IconoCheck = crearIcono(CheckCircle2);
export const IconoDinero = crearIcono(CircleDollarSign);
export const IconoSol = crearIcono(Sun);
export const IconoViento = crearIcono(Wind);
export const IconoChat = crearIcono(MessageCircle);
export const IconoEnviar = crearIcono(Send);
export const IconoCerrar = crearIcono(X);
export const IconoLupa = crearIcono(Search);
export const IconoMovimiento = crearIcono(Repeat2);
export const IconoRuta = crearIcono(Route);
export const IconoUbicacion = crearIcono(MapPinned);
export const IconoClinica = crearIcono(Stethoscope);
export const IconoVacuna = crearIcono(Syringe);
export const IconoQR = crearIcono(QrCode);
export const IconoSincronizacion = crearIcono(CloudCog);

// Símbolo propio de marca: deliberadamente no se sustituye por un icono genérico.
export const IconoRancho = ({ width = 18, height = 18, ...props }) => (
  <svg width={width} height={height} viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M3 21h22M5 21v-7l4-3v10M11 15h14M17 15v6M23 15v6" />
    <path d="M11 10c1.1-2.5 4.9-2.5 6 0M11 10 8.5 7M17 10l2.5-3M11.5 10.5c0 3.8 5 3.8 5 0" />
    <circle cx="13" cy="10.5" r="0.45" fill="currentColor" stroke="none" />
    <circle cx="15" cy="10.5" r="0.45" fill="currentColor" stroke="none" />
  </svg>
);
