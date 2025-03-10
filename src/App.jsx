import React, { useState, useEffect, useRef } from "react";
import AudioPlayer from "react-h5-audio-player";
import {
  FaList,
  FaSearch,
  FaCompactDisc,
  FaDownload,
  FaPlay,
  FaPlus
} from "react-icons/fa";
import "react-h5-audio-player/lib/styles.css";
import "./audio.scss";

const FALLBACK_URL = "https://jibharo-v.vercel.app";

const App = () => {
  // Try to load the API base URL from localStorage if it exists.
  const [apiBaseUrl, setApiBaseUrl] = useState(() => {
    return localStorage.getItem("apiBaseUrl") || "";
  });
  const [inputUrl, setInputUrl] = useState("");

  // Remove any trailing slash from the provided URL.
  const normalizeUrl = (url) => url.replace(/\/+$/, "");

  const handleApiSubmit = (e) => {
    e.preventDefault();
    let normalized = normalizeUrl(inputUrl.trim());
    // If user enters "honor", fallback to FALLBACK_URL
    if (normalized.toLowerCase() === "honor") {
      normalized = FALLBACK_URL;
    }
    if (normalized) {
      setApiBaseUrl(normalized);
      localStorage.setItem("apiBaseUrl", normalized);
    }
  };

  // Allow user to reset API configuration.
  const resetApi = () => {
    localStorage.removeItem("apiBaseUrl");
    setApiBaseUrl("");
    setInputUrl("");
  };

  // If no API base URL is provided, show a configuration screen.
  if (!apiBaseUrl) {
    return (
      <div className="api-config">
        <h2>Enter API Base URL</h2>
        <form onSubmit={handleApiSubmit}>
          <input
            type="text"
            placeholder='Enter your API URL (e.g. https://your-api.com)'
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
          />
          <button type="submit">Submit</button>
        </form>
      </div>
    );
  }

  return <Player apiBaseUrl={apiBaseUrl} onResetApi={resetApi} />;
};

const Player = ({ apiBaseUrl, onResetApi }) => {
  // States for search, queue, player UI and lyrics.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchType, setSearchType] = useState("song");
  const [currentPage, setCurrentPage] = useState(0);
  const pageSize = 6;

  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const [showQueue, setShowQueue] = useState(true);
  const [playerCollapsed, setPlayerCollapsed] = useState(false);
  const playerRef = useRef(null);

  // Lyrics-related states.
  const [lyricsVisible, setLyricsVisible] = useState(false);
  const [lyrics, setLyrics] = useState({ syncable: false, lines: [] });
  const [currentTime, setCurrentTime] = useState(0);

  // Auto-play when queue or index changes.
  useEffect(() => {
    if (queue.length > 0 && playerRef.current) {
      playerRef.current.audio.current
        .play()
        .catch(() => console.log("Autoplay not allowed by browser."));
    }
  }, [currentIndex, queue]);

  // Remove older queue items once a new song starts.
  useEffect(() => {
    if (currentIndex > 0 && currentIndex < queue.length) {
      setQueue((prev) => prev.slice(currentIndex));
      setCurrentIndex(0);
    }
  }, [currentIndex]);

  // Fetch lyrics whenever the current song changes.
  useEffect(() => {
    async function loadLyrics() {
      const currentSong = queue[currentIndex];
      if (!currentSong) {
        setLyrics({ syncable: false, lines: [] });
        return;
      }
      const fetched = await fetchLyricsForSong(currentSong);
      setLyrics(fetched);
    }
    loadLyrics();
  }, [currentIndex, queue]);

  // Compute the current lyric index for synchronized lyrics.
  let currentLyricIndex = -1;
  if (lyrics.syncable && lyrics.lines.length > 0) {
    currentLyricIndex = lyrics.lines.findIndex((line, index, arr) => {
      if (index === arr.length - 1) return currentTime >= line.time;
      return currentTime >= line.time && currentTime < arr[index + 1].time;
    });
  }

  // ---------------------------
  // API call functions using apiBaseUrl
  // ---------------------------
  async function fetchSongDetailsFromSaavnDevById(songId) {
    try {
      const res = await fetch(`${apiBaseUrl}/api/songs/${songId}`);
      if (!res.ok) {
        console.warn(
          `${apiBaseUrl} responded with status=${res.status} for ID=${songId}`
        );
        return null;
      }
      const data = await res.json();
      if (data.success && Array.isArray(data.data) && data.data.length > 0) {
        return data.data[0];
      }
    } catch (err) {
      console.error("Error fetching song details from API:", err);
    }
    return null;
  }

  async function fetchRecommendations(songId) {
    try {
      const res = await fetch(`${apiBaseUrl}/api/songs/${songId}/suggestions`);
      const data = await res.json();
      if (data.success && Array.isArray(data.data) && data.data.length > 0) {
        return data.data;
      }
    } catch (err) {
      console.error("Error fetching suggestions from API:", err);
    }
    return [];
  }

  function mapJioSearchItemToBasic(item) {
    return {
      id: item.id || "",
      type: (item.type || "").toLowerCase(),
      title: item.title || "",
      image: item.image || null
    };
  }

  function unifySongData(jioItem, devDetails) {
    if (!devDetails) {
      return {
        id: jioItem.id,
        name: jioItem.title,
        type: "song",
        playCount: 0,
        downloadUrl: [],
        image: jioItem.image ? [{ url: jioItem.image }] : [],
        artists: { primary: [{ name: "" }] }
      };
    }
    return {
      id: devDetails.id || jioItem.id,
      name: devDetails.name || jioItem.title,
      type: devDetails.type || "song",
      playCount: devDetails.playCount || 0,
      downloadUrl: devDetails.downloadUrl || [],
      image: devDetails.image || (jioItem.image ? [{ url: jioItem.image }] : []),
      artists: devDetails.artists || { primary: [{ name: "" }] }
    };
  }

  function getHighestQualityUrl(downloadUrls) {
    if (!downloadUrls || !Array.isArray(downloadUrls) || downloadUrls.length === 0)
      return "";
    const best = downloadUrls.find((d) => d.quality === "320kbps");
    return best ? best.url : downloadUrls[0].url;
  }

  function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function downloadCurrentTrack(song) {
    if (!song || !song.downloadUrl) {
      console.log("No current track or no download URL");
      return;
    }
    const bestUrl = getHighestQualityUrl(song.downloadUrl);
    if (!bestUrl) {
      console.log("No best URL found for current track.");
      return;
    }
    fetch(bestUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Network response was not ok");
        }
        return response.blob();
      })
      .then((blob) => {
        const blobUrl = window.URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = blobUrl;
        anchor.download = `${song.name || "Track"}.m4a`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        window.URL.revokeObjectURL(blobUrl);
      })
      .catch((err) => {
        console.error("Failed to download track:", err);
      });
  }

  /**
   * Fetch lyrics for a given song using lyrics.ovh and The Lyrics API.
   */
  async function fetchLyricsForSong(song) {
    if (!song || !song.name) return { syncable: false, lines: [] };
    const artist =
      song.artists && song.artists.primary && song.artists.primary[0]
        ? song.artists.primary[0].name
        : "";
    const title = song.name;

    function parseLyrics(lyricsText) {
      const rawLines = lyricsText.split("\n");
      const parsedLines = rawLines.map((line) => {
        const match = line.match(/^\[(\d+):(\d+\.?\d*)\](.*)$/);
        if (match) {
          const minutes = parseInt(match[1], 10);
          const seconds = parseFloat(match[2]);
          return { time: minutes * 60 + seconds, text: match[3].trim() };
        }
        return { time: null, text: line.trim() };
      });
      const isSyncable = parsedLines.every((l) => l.time !== null);
      return { syncable: isSyncable, lines: parsedLines };
    }

    async function tryLyricsOvh() {
      try {
        const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(
          artist
        )}/${encodeURIComponent(title)}`;
        const res = await fetch(url);
        console.log("lyrics.ovh status:", res.status);
        const data = await res.json();
        console.log("lyrics.ovh data:", data);
        return data && data.lyrics ? data : null;
      } catch (err) {
        console.error("Error fetching from lyrics.ovh:", err);
        return null;
      }
    }

    async function tryTheLyricsAPI() {
      try {
        const url = "https://the-lyrics-api.herokuapp.com/lyrics";
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            artist: artist,
            song: title,
            lang: "hin"
          })
        });
        console.log("The Lyrics API status:", res.status);
        const data = await res.json();
        console.log("The Lyrics API data:", data);
        return data && data.lyrics ? data : null;
      } catch (err) {
        console.error("Error fetching from The Lyrics API:", err);
        return null;
      }
    }

    let data = await tryLyricsOvh();
    if (!data || !data.lyrics.trim()) {
      console.log("lyrics.ovh returned no/empty lyrics. Trying The Lyrics API...");
      data = await tryTheLyricsAPI();
    }
    if (data && data.lyrics) {
      console.log("Lyrics found:", data.lyrics);
      return parseLyrics(data.lyrics);
    }
    console.warn("No lyrics found for this song.");
    return { syncable: false, lines: [] };
  }

  // ---------------------------
  // UI Rendering Functions
  // ---------------------------
  const renderLyricsHeader = () => (
    <div className="lyrics-header">
      <button
        className="back-to-search-button"
        onClick={() => setLyricsVisible(false)}
      >
        ← Back to Search
      </button>
      <h2>Lyrics</h2>
    </div>
  );

  const renderLyricsFullscreen = () => (
    <div className="lyrics-fullscreen">
      {renderLyricsHeader()}
      <div className="lyrics-content">
        {lyrics.lines.length === 0 ? (
          <p>No lyrics found.</p>
        ) : lyrics.syncable ? (
          <div className="lyrics-window">
            <p style={{ opacity: 0.5 }}>
              {currentLyricIndex > 0 ? lyrics.lines[currentLyricIndex - 1].text : ""}
            </p>
            <p style={{ fontWeight: "bold" }}>
              {currentLyricIndex !== -1 ? lyrics.lines[currentLyricIndex].text : ""}
            </p>
            <p style={{ opacity: 0.5 }}>
              {currentLyricIndex + 1 < lyrics.lines.length
                ? lyrics.lines[currentLyricIndex + 1].text
                : ""}
            </p>
          </div>
        ) : (
          <div className="lyrics-full">
            {lyrics.lines.map((line, index) => (
              <p key={index}>{line.text}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // ---------------------------
  // Event Handlers
  // ---------------------------
  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery) return;

    const jioUrl =
      `https://galibproxy.fly.dev/https://www.jiosaavn.com/api.php` +
      `?p=1` +
      `&q=${encodeURIComponent(searchQuery)}` +
      `&_format=json` +
      `&_marker=0` +
      `&api_version=4` +
      `&ctx=web6dot0` +
      `&n=50` +
      `&__call=search.getResults`;

    try {
      const res = await fetch(jioUrl);
      const data = await res.json();

      if (!data || !Array.isArray(data.results) || data.results.length === 0) {
        setSearchResults([]);
        return;
      }

      if (searchType === "song") {
        const songs = data.results
          .filter((r) => (r.type || "").toLowerCase() === "song")
          .map(mapJioSearchItemToBasic);

        const promises = songs.map(async (jioItem) => {
          const devDetails = await fetchSongDetailsFromSaavnDevById(jioItem.id);
          return unifySongData(jioItem, devDetails);
        });
        const results = await Promise.all(promises);
        results.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));

        setSearchResults(results);
        setCurrentPage(0);
      } else if (searchType === "artist") {
        const artists = data.results.filter(
          (r) => (r.type || "").toLowerCase() === "artist"
        );
        setSearchResults(artists);
      } else if (searchType === "album") {
        const albums = data.results.filter(
          (r) => (r.type || "").toLowerCase() === "album"
        );
        setSearchResults(albums);
      } else if (searchType === "playlist") {
        const playlists = data.results.filter(
          (r) => (r.type || "").toLowerCase() === "playlist"
        );
        setSearchResults(playlists);
      }
    } catch (err) {
      console.error("Error searching or fetching dev details:", err);
    }
  };

  const handleSongEnd = () => {
    handleNextSong();
  };

  const handleNextSong = async () => {
    if (currentIndex < queue.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      if (queue.length === 0) {
        console.log("Queue is empty, no suggestions to fetch.");
        return;
      }
      const currentSong = queue[currentIndex];
      console.log("Fetching suggestions for last track ID=", currentSong.id);

      const suggestions = await fetchRecommendations(currentSong.id);
      if (suggestions.length === 0) {
        console.log("No suggestions found or mismatch ID. Autoplay stops.");
        return;
      }

      let randomized = shuffleArray(suggestions);
      const picksCount = 3 + Math.floor(Math.random() * 3);
      randomized = randomized.slice(0, picksCount);

      const suggestedPromises = randomized.map(async (suggItem) => {
        const devDetails = await fetchSongDetailsFromSaavnDevById(suggItem.id);
        const jioFormat = {
          id: suggItem.id,
          title: suggItem.name,
          image:
            suggItem.image && suggItem.image.length > 0
              ? suggItem.image[0].url
              : null,
          type: "song"
        };
        const unified = unifySongData(jioFormat, devDetails);
        return {
          ...unified,
          src: getHighestQualityUrl(unified.downloadUrl)
        };
      });

      const unifiedSuggestions = await Promise.all(suggestedPromises);

      setQueue((prev) => [...prev, ...unifiedSuggestions]);
      setCurrentIndex((old) => old + 1);
    }
  };

  const handlePreviousSong = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    } else {
      console.log("Already at the first track in the queue.");
    }
  };

  const handleAddToQueue = (song) => {
    const newSong = {
      ...song,
      src: getHighestQualityUrl(song.downloadUrl)
    };
    setQueue((prev) => [...prev, newSong]);
  };

  const handlePlayNow = (song) => {
    const newSong = {
      ...song,
      src: getHighestQualityUrl(song.downloadUrl)
    };
    setQueue([newSong]);
    setCurrentIndex(0);
  };

  // Artist/Album/Playlist selection functions.
  const handleArtistSelect = async (artist) => {
    try {
      const res = await fetch(
        `${apiBaseUrl}/api/artists/${artist.id}/songs?sortBy=popularity&sortOrder=desc&page=0`
      );
      const data = await res.json();
      if (data.success && data.data?.songs) {
        const sorted = data.data.songs.sort(
          (a, b) => (b.playCount || 0) - (a.playCount || 0)
        );
        setSearchResults(sorted);
        setCurrentPage(0);
        setSearchType("song");
      }
    } catch (err) {
      console.error("Error retrieving artist songs:", err);
    }
  };

  const handleAlbumSelect = async (album) => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/albums?id=${album.id}`);
      const data = await res.json();
      if (data.success && data.data?.songs) {
        const sorted = data.data.songs.sort(
          (a, b) => (b.playCount || 0) - (a.playCount || 0)
        );
        setSearchResults(sorted);
        setCurrentPage(0);
        setSearchType("song");
      }
    } catch (err) {
      console.error("Error retrieving album songs:", err);
    }
  };

  const handlePlaylistSelect = async (playlist) => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/playlists?id=${playlist.id}`);
      const data = await res.json();
      if (data.success && data.data?.songs) {
        const sorted = data.data.songs.sort(
          (a, b) => (b.playCount || 0) - (a.playCount || 0)
        );
        setSearchResults(sorted);
        setCurrentPage(0);
        setSearchType("song");
      }
    } catch (err) {
      console.error("Error retrieving playlist songs:", err);
    }
  };

  // Pagination.
  const startIndex = currentPage * pageSize;
  const endIndex = startIndex + pageSize;
  const currentSongResults = searchResults.slice(startIndex, endIndex);

  const handleNextPage = () => {
    if (endIndex >= searchResults.length) {
      setCurrentPage(0);
    } else {
      setCurrentPage(currentPage + 1);
    }
  };

  // Render the left section: either the search/results view or full-screen lyrics.
  const renderLeftSection = () => {
    if (lyricsVisible) {
      return renderLyricsFullscreen();
    }
    return (
      <>
        <div className="search-bar">
          <form onSubmit={handleSearch}>
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button type="submit">
              <FaSearch />
            </button>
          </form>
        </div>

        {searchType === "song" && (
          <>
            <div className="results-container">
              {currentSongResults.map((song, idx) => (
                <div key={idx} className="song-card">
                  <img
                    src={song.image && song.image.length ? song.image[0].url : ""}
                    alt={song.name}
                  />
                  <div className="song-info">
                    <h4>{song.name}</h4>
                    <p>{song?.artists?.primary?.[0]?.name || ""}</p>
                    <p className="play-count">{song.playCount + " plays"}</p>
                  </div>
                  <div className="card-buttons">
                    <button
                      className="icon-button play-now-button"
                      onClick={() => handlePlayNow(song)}
                    >
                      <FaPlay />
                    </button>
                    <button
                      className="icon-button add-to-queue-button"
                      onClick={() => handleAddToQueue(song)}
                    >
                      <FaPlus />
                    </button>
                    <button
                      className="icon-button download-song-button"
                      onClick={() => downloadCurrentTrack(song)}
                    >
                      <FaDownload />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {searchResults.length > pageSize && (
              <div className="next-button-container">
                <button className="next-button" onClick={handleNextPage}>
                  Next {pageSize}
                </button>
              </div>
            )}
          </>
        )}
      </>
    );
  };

  return (
    <div className="app-container">
      {/* LEFT SECTION */}
      <div className="left-section">{renderLeftSection()}</div>

      {/* RIGHT SECTION */}
      <div className="right-section">
        <div className="controls">
          <button
            className="queue-toggle-button"
            onClick={() => setShowQueue(!showQueue)}
          >
            <FaList />
            {showQueue ? " Hide Queue" : " Show Queue"}
          </button>
          <button
            className="lyrics-toggle-button"
            onClick={() => setLyricsVisible(!lyricsVisible)}
          >
            Lyrics
          </button>
          <button className="change-api-button" onClick={onResetApi}>
            Change API
          </button>
        </div>
        {showQueue && (
          <div className="play-queue">
            <h3>Play Queue</h3>
            {queue.map((song, idx) => (
              <button
                key={idx}
                className={`queue-song ${idx === currentIndex ? "active" : ""}`}
                onClick={() => setCurrentIndex(idx)}
              >
                {song.title || song.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Collapsible Audio Player at Bottom */}
      {queue.length > 0 && (
        <div className={`audio-container ${playerCollapsed ? "collapsed" : ""}`}>
          <div className="audio-player-container">
            <button
              className="download-track-button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                downloadCurrentTrack(queue[currentIndex]);
              }}
            >
              Download
            </button>
            <button
              className="collapse-button"
              onClick={() => setPlayerCollapsed(!playerCollapsed)}
            >
              {playerCollapsed ? "Show Player" : "Hide Player"}
            </button>
            <AudioPlayer
              ref={playerRef}
              autoPlay
              showJumpControls={false}
              showSkipControls
              onClickNext={handleNextSong}
              onClickPrevious={handlePreviousSong}
              onEnded={handleSongEnd}
              src={queue[currentIndex]?.src || ""}
              onPlay={() => console.log("Playing:", queue[currentIndex]?.title)}
              onListen={(time) => setCurrentTime(time)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
