import React, { useState, useEffect, useRef } from "react";
import AudioPlayer from "react-h5-audio-player";
import { FaList, FaSearch, FaCompactDisc, FaDownload, FaPlay, FaPlus } from "react-icons/fa";
import "react-h5-audio-player/lib/styles.css";
import "./audio.scss";

/**
 * 1) fetchSongDetailsFromSaavnDevById   -> fetch track details from jibharo-v
 * 2) mapJioSearchItemToBasic           -> minimal shape from JioSaavn search
 * 3) unifySongData                     -> merges Jio item with dev details
 * 4) getHighestQualityUrl              -> picks 320kbps from .downloadUrl
 * 5) fetchRecommendations              -> fetch suggestions from jibharo-v, returns array of songs
 */

// ---------------------------
// 1) Retrieve details from jibharo-v
// ---------------------------
async function fetchSongDetailsFromSaavnDevById(songId) {
  try {
    const res = await fetch(`https://jibharo-v.vercel.app/api/songs/${songId}`);
    if (!res.ok) {
      console.warn(`jibharo-v.vercel.app responded with status=${res.status} for ID=${songId}`);
      return null;
    }
    const data = await res.json();
    if (data.success && Array.isArray(data.data) && data.data.length > 0) {
      return data.data[0]; // The first track details
    }
  } catch (err) {
    console.error("Error fetching song details from jibharo-v.vercel.app:", err);
  }
  return null;
}

// ---------------------------
// 2) Minimal shape for jio results
// ---------------------------
function mapJioSearchItemToBasic(item) {
  return {
    id: item.id || "",
    type: (item.type || "").toLowerCase(),
    title: item.title || "",
    image: item.image || null
  };
}

// ---------------------------
// 3) Merge Jio item + dev item
// ---------------------------
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

// ---------------------------
// 4) Grab 320kbps from .downloadUrl
// ---------------------------
function getHighestQualityUrl(downloadUrls) {
  if (!downloadUrls || !Array.isArray(downloadUrls) || downloadUrls.length === 0) return "";
  const best = downloadUrls.find((d) => d.quality === "320kbps");
  return best ? best.url : downloadUrls[0].url;
}

// ---------------------------
// 4a) Shuffle array utility
// ---------------------------
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------
// 5) fetchRecommendations
//    Now returns data.data as an array
// ---------------------------
async function fetchRecommendations(songId) {
  try {
    const res = await fetch(`https://jibharo-v.vercel.app/api/songs/${songId}/suggestions`);
    const data = await res.json();
    // shape is { success, data: [ {id, name, ...}, ... ] }
    if (data.success && Array.isArray(data.data) && data.data.length > 0) {
      return data.data;
    }
  } catch (err) {
    console.error("Error fetching suggestions from jibharo-v.vercel.app:", err);
  }
  return [];
}

// ---------------------------
// Provide "download track" helper
//   - triggers a direct download of the currently playing .mp4
// ---------------------------
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

  // Fetch the file as a blob
  fetch(bestUrl)
    .then(response => {
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      return response.blob();
    })
    .then(blob => {
      // Create a blob URL for the downloaded file
      const blobUrl = window.URL.createObjectURL(blob);
      
      // Create an invisible anchor element and set the download attribute
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = `${song.name || "Track"}.m4a`;
      document.body.appendChild(anchor);
      
      // Trigger the download
      anchor.click();
      
      // Clean up
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(blobUrl);
    })
    .catch(err => {
      console.error("Failed to download track:", err);
    });
}



// ---------------------------
// Main Player
// ---------------------------
const Player = () => {
  // A) States
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

  // B) useEffects
  useEffect(() => {
    if (queue.length > 0 && playerRef.current) {
      playerRef.current.audio.current
        .play()
        .catch(() => console.log("Autoplay not allowed by browser."));
    }
  }, [currentIndex, queue]);

  // remove older queue items
  useEffect(() => {
    if (currentIndex > 0 && currentIndex < queue.length) {
      setQueue((prev) => prev.slice(currentIndex));
      setCurrentIndex(0);
    }
  }, [currentIndex]);

  // C) Searching
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

        // fetch dev details
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

  // D) Next/Previous & Suggestions
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

      // **Change #1**: Randomize suggestions to reduce repetition
      let randomized = shuffleArray(suggestions);
      // Optionally slice the first 3-5
      const picksCount = 3 + Math.floor(Math.random() * 3); // random 3..5
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

  // E) Adding to queue / Play now
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

  // F) Artist/Album/Playlist
  const handleArtistSelect = async (artist) => {
    try {
      const res = await fetch(
        `https://jibharo-v.vercel.app/api/artists/${artist.id}/songs?sortBy=popularity&sortOrder=desc&page=0`
      );
      const data = await res.json();
      if (data.success && data.data?.songs) {
        const sorted = data.data.songs.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
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
      const res = await fetch(`https://jibharo-v.vercel.app/api/albums?id=${album.id}`);
      const data = await res.json();
      if (data.success && data.data?.songs) {
        const sorted = data.data.songs.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
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
      const res = await fetch(`https://jibharo-v.vercel.app/api/playlists?id=${playlist.id}`);
      const data = await res.json();
      if (data.success && data.data?.songs) {
        const sorted = data.data.songs.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
        setSearchResults(sorted);
        setCurrentPage(0);
        setSearchType("song");
      }
    } catch (err) {
      console.error("Error retrieving playlist songs:", err);
    }
  };

  // G) Pagination
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

  // H) Render
  return (
    <div className="app-container">
      {/* LEFT SECTION */}
      <div className="left-section">
        {/* Search Type */}
        {/* <div className="search-type">
          <label htmlFor="searchType">Search for:</label>
          <select
            id="searchType"
            value={searchType}
            onChange={(e) => setSearchType(e.target.value)}
          >
            <option value="song">Song</option>
            <option value="artist">Artist</option>
            <option value="album">Album</option>
            <option value="playlist">Playlist</option>
          </select>
        </div> */}

        {/* Search Bar */}
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

        {/* Results */}
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

        {searchType === "artist" && (
          <div className="results-container">
            {currentSongResults.map((artist, idx) => (
              <div
                key={idx}
                className="artist-card"
                onClick={() => handleArtistSelect(artist)}
              >
                {artist.image ? (
                  <img src={artist.image} alt={artist.title || artist.name} />
                ) : (
                  <div className="fallback-icon">
                    <FaCompactDisc />
                  </div>
                )}
                <div className="artist-info">
                  <h4>{artist.title || artist.name}</h4>
                </div>
              </div>
            ))}
            {searchResults.length > pageSize && (
              <div className="next-button-container">
                <button className="next-button" onClick={handleNextPage}>
                  Next {pageSize}
                </button>
              </div>
            )}
          </div>
        )}

        {searchType === "album" && (
          <div className="results-container">
            {currentSongResults.map((album, idx) => (
              <div
                key={idx}
                className="album-card"
                onClick={() => handleAlbumSelect(album)}
              >
                {album.image ? (
                  <img src={album.image} alt={album.title || album.name} />
                ) : (
                  <div className="fallback-icon">
                    <FaCompactDisc />
                  </div>
                )}
                <div className="album-info">
                  <h4>{album.title || album.name}</h4>
                </div>
              </div>
            ))}
            {searchResults.length > pageSize && (
              <div className="next-button-container">
                <button className="next-button" onClick={handleNextPage}>
                  Next {pageSize}
                </button>
              </div>
            )}
          </div>
        )}

        {searchType === "playlist" && (
          <div className="results-container">
            {currentSongResults.map((pl, idx) => (
              <div
                key={idx}
                className="playlist-card"
                onClick={() => handlePlaylistSelect(pl)}
              >
                {pl.image ? (
                  <img src={pl.image} alt={pl.title || pl.name} />
                ) : (
                  <div className="fallback-icon">
                    <FaCompactDisc />
                  </div>
                )}
                <div className="playlist-info">
                  <h4>{pl.title || pl.name}</h4>
                </div>
              </div>
            ))}
            {searchResults.length > pageSize && (
              <div className="next-button-container">
                <button className="next-button" onClick={handleNextPage}>
                  Next {pageSize}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* RIGHT SECTION */}
      <div className="right-section">
        <button
          className="queue-toggle-button"
          onClick={() => setShowQueue(!showQueue)}
        >
          <FaList />
          {showQueue ? " Hide Queue" : " Show Queue"}
        </button>
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
        <div
          className={`audio-container ${playerCollapsed ? "collapsed" : ""}`}
        >
          <div className="audio-player-container">
            {/* 
              Change #2: Small download button for current track 
              You can position it anywhere inside audio-player-container
            */}
            <button
              style={{
                position: "absolute",
                top: "-35px",
                left: "10px",
                background: "#b9a0c9",
                color: "#fff",
                border: "none",
                fontSize: "0.8rem",
                padding: "0.3rem 0.6rem",
                borderRadius: "12px",
                cursor: "pointer",
              }}
              onClick={(e) => {
                e.preventDefault();      //  <-- ensure no default button behaviors
                e.stopPropagation();     //  <-- and no parent clicks
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
              onPlay={() =>
                console.log("Playing:", queue[currentIndex]?.title)
              }
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default Player;
