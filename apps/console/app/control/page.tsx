import type { Metadata } from 'next';
import { ControlRoom } from '@/control/ControlRoom';

export const metadata: Metadata = {
  title: 'Control room',
  description:
    'What the airlock is holding, what it has refused and why, and whether the record of what it did can still be trusted.',
};

export default function Page() {
  return <ControlRoom />;
}
