import { useRoute } from "./lib/router.js";
import { Create } from "./pages/Create.js";
import { Landing } from "./pages/Landing.js";
import { Play } from "./pages/Play.js";
import { Room } from "./pages/Room.js";

export function App() {
  const route = useRoute();

  // Phone ergonomics stay (big tap targets, no scrolling during play), but the
  // layout uses the room it's given instead of pretending to be a phone.
  return (
    <main className="mx-auto flex h-full w-full max-w-md flex-col bg-white sm:max-w-2xl lg:max-w-4xl">
      {route.name === "landing" && <Landing />}
      {route.name === "create" && <Create />}
      {route.name === "play" && <Play quizId={route.quizId} />}
      {route.name === "room" && <Room code={route.code} />}
    </main>
  );
}
