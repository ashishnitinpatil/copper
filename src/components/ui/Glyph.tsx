import {
  Activity, Ambulance, Apple, Award, Baby, Bandage, Banknote, BarChart3, Bath, Bed, Beef, Beer, Bell, BicepsFlexed,
  Bike, Bird, Bitcoin, BookOpen, Briefcase, Brush, Building2, Bus, CakeSlice, Calculator, Camera, Car,
  CarTaxiFront, Carrot, Cat, Church, Cigarette, CircleHelp, Clapperboard, Coffee, Coins, Cookie, CookingPot,
  CreditCard, Croissant, CupSoda, Dices, Dog, Droplet, Dumbbell, EggFried, Euro, Eye, Fish, Flag, Flame,
  Flower2, Footprints, Fuel, Gamepad2, Gem, Gift, Glasses, Globe, GraduationCap, Guitar, Hamburger, Handshake,
  HandCoins, HandHeart, Headphones, Heart, HeartPulse, Hospital, Hotel, House, IceCreamCone, JapaneseYen, Key,
  Landmark, Laptop, Lightbulb, Lock, Luggage, Map, Martini, Medal, Mic, Milk, MountainSnow, Music, Package,
  Palette, PartyPopper, PawPrint, Pencil, PiggyBank, Pill, Pin, Pizza, Plane, Plug, Plus, Popcorn, PoundSterling,
  Receipt, Repeat, Route, Salad, Scale, School, Scissors, Shield, Shirt, ShoppingBag, ShoppingBasket,
  ShoppingCart, Smartphone, Smile, Sofa, Soup, Sparkles, SprayCan, Sprout, SquareParking, Star, Stethoscope,
  Store, Syringe, Target, Tent, Ticket, Trash2, TrainFront, TramFront, TreePalm, TrendingDown, TrendingUp,
  TriangleAlert, Trophy, Tv, Undo2, Users, UtensilsCrossed, Volleyball, Wallet, Watch, Waves, Wifi, Wine,
  Wrench, ToyBrick, Sandwich, ScrollText, Tag,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Icons are stored as emoji (plain text, so any device and any older copy of
// the app still shows something sensible) and drawn as a simple line icon.
// An emoji with no line icon here is shown as itself, toned down.
const LINE_ICONS: Record<string, LucideIcon> = {
  // Food & drink
  '🍽': UtensilsCrossed, '🛒': ShoppingCart, '🍔': Hamburger, '🍕': Pizza, '🍜': Soup, '🍣': Fish, '🥗': Salad,
  '🥐': Croissant, '🍰': CakeSlice, '🍦': IceCreamCone, '☕': Coffee, '🍵': Coffee, '🍺': Beer, '🍷': Wine,
  '🍸': Martini, '🥤': CupSoda, '🍎': Apple, '🥦': Carrot, '🥩': Beef, '🍳': EggFried, '🥡': Sandwich, '🍿': Popcorn,
  '🍪': Cookie,
  // Home & bills
  '🏠': House, '🏘': Building2, '🔑': Key, '💡': Lightbulb, '🔌': Plug, '💧': Droplet, '🔥': Flame, '📶': Wifi,
  '📱': Smartphone, '📺': Tv, '🛋': Sofa, '🛏': Bed, '🧹': Brush, '🧺': ShoppingBasket, '🧼': Bath, '🔧': Wrench,
  '🪴': Sprout, '🧾': Receipt, '🗑': Trash2, '🍲': CookingPot,
  // Getting around
  '🚗': Car, '⛽': Fuel, '🅿': SquareParking, '🚕': CarTaxiFront, '🚌': Bus, '🚇': TramFront, '🚆': TrainFront,
  '🛵': Bike, '🚲': Bike, '✈': Plane, '🧳': Luggage, '🏨': Hotel, '🗺': Map, '🛣': Route, '🔩': Wrench, '🚙': Car,
  '🚶': Footprints,
  // Shopping
  '🛍': ShoppingBag, '👕': Shirt, '👗': Shirt, '👟': Footprints, '👜': ShoppingBag, '💄': Sparkles, '💍': Gem,
  '👓': Glasses, '⌚': Watch, '💻': Laptop, '🎧': Headphones, '📷': Camera, '🎮': Gamepad2, '🧸': ToyBrick,
  '🎁': Gift, '📦': Package, '🏪': Store,
  // Health & care
  '🏥': Hospital, '🩺': Stethoscope, '💊': Pill, '🦷': Smile, '👁': Eye, '💪': BicepsFlexed, '🧘': HeartPulse,
  '🏋': Dumbbell, '💇': Scissors, '💅': Sparkles, '🧴': SprayCan, '🩹': Bandage, '💉': Syringe, '🚑': Ambulance,
  // Fun & hobbies
  '🎬': Clapperboard, '🎵': Music, '🎤': Mic, '🎨': Palette, '📚': BookOpen, '🎲': Dices, '⚽': Volleyball,
  '🏏': Activity, '🎾': Activity, '🏊': Waves, '⛳': Flag, '🎟': Ticket, '🎉': PartyPopper, '🎸': Guitar,
  '📸': Camera, '🏕': Tent, '🏆': Trophy, '🏖': TreePalm, '🌴': TreePalm, '🏔': MountainSnow,
  // Family & pets
  '👶': Baby, '🍼': Milk, '🧒': Baby, '🎓': GraduationCap, '🏫': School, '✏': Pencil, '👪': Users,
  '👨‍👩‍👧': Users, '❤': Heart, '💐': Flower2, '🐶': Dog, '🐱': Cat, '🐾': PawPrint, '🐟': Fish, '🐦': Bird,
  // Money & work
  '💼': Briefcase, '💰': Coins, '💵': Banknote, '💳': CreditCard, '🏦': Landmark, '📈': TrendingUp,
  '📉': TrendingDown, '🪙': Coins, '💸': HandCoins, '🧮': Calculator, '🏛': Landmark, '🤝': Handshake,
  '🎯': Target, '📊': BarChart3, '🔁': Repeat, '↩': Undo2, '👛': Wallet, '⚖': Scale, '₿': Bitcoin,
  '💶': Euro, '💷': PoundSterling, '💴': JapaneseYen, '🧧': Gift, '🐷': PiggyBank, '🏧': Banknote,
  '🛡': Shield, '📜': ScrollText, '🔒': Lock,
  // Other
  '➕': Plus, '🏷': Tag, '⭐': Star, '📌': Pin, '🔔': Bell, '🌍': Globe, '🙏': HandHeart, '⛪': Church, '🕌': Landmark,
  '🛕': Landmark, '🎗': Award, '🚬': Cigarette, '❓': CircleHelp, '⚠': TriangleAlert, '🏅': Medal,
};

/** Emoji variation selectors don't change which icon is meant. */
const normalize = (icon: string) => icon.trim().replace(/️/g, '');

export function lineIconFor(icon: string | null | undefined): LucideIcon | null {
  return icon ? (LINE_ICONS[normalize(icon)] ?? null) : null;
}

/**
 * A category, account or tag icon as a simple line drawing, inheriting the
 * surrounding text colour. Renders nothing for an empty icon.
 */
export function Glyph({ icon, className = 'h-[1em] w-[1em]' }: { icon: string | null | undefined; className?: string }) {
  if (!icon || !icon.trim()) return null;
  const Line = lineIconFor(icon);
  if (Line) return <Line aria-hidden className={`shrink-0 ${className}`} strokeWidth={1.75} />;
  // Unmapped emoji: keep it, but quiet it down to sit with the line icons.
  return (
    <span aria-hidden className="inline-block shrink-0 leading-none opacity-70 grayscale">
      {icon.trim()}
    </span>
  );
}
