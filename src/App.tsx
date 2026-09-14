import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ToastHost } from "./components/ui/Primitives";
import { AppShell } from "./components/layout/AppShell";
import Home from "./pages/Home";
import Search from "./pages/Search";
import LibraryPage from "./pages/LibraryPage";
import QueuePage from "./pages/QueuePage";
import CollectionPage from "./pages/CollectionPage";
import PlaylistPage from "./pages/PlaylistPage";
import ArtistPage from "./pages/ArtistPage";
import TrackPage from "./pages/TrackPage";
import StudioPage from "./pages/StudioPage";
import ProfilePage from "./pages/ProfilePage";
import AdminPage from "./pages/AdminPage";
import About, { NotFound } from "./pages/About";

/* Registering what accounts have published has to happen before the first route
   renders, or a deep link to your own nasheed would 404 on a cold load. */
import "./store/studio";

export default function App() {
  return (
    <ToastHost>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Home />} />
            <Route path="search" element={<Search />} />
            <Route path="library" element={<LibraryPage />} />
            <Route path="queue" element={<QueuePage />} />
            <Route path="about" element={<About />} />
            <Route path="c/:id" element={<CollectionPage />} />
            <Route path="p/:id" element={<PlaylistPage />} />
            <Route path="a/:id" element={<ArtistPage />} />
            <Route path="t/:id" element={<TrackPage />} />
            <Route path="studio" element={<StudioPage />} />
            <Route path="me" element={<ProfilePage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastHost>
  );
}
