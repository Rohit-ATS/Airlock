import { Landing } from '@/landing/Landing';

/**
 * The front door.
 *
 * A server component wrapping a client tree: the landing page is a static
 * document apart from two live demos, so it renders on the server, ships its
 * markup immediately, and hydrates the interactive parts afterwards.
 */
export default function Page() {
  return <Landing />;
}
