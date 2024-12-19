import { html, PropertyValues, svg } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { BaseElement } from "../app.js";
import { Api } from "../api.js";
import { EpisodeSegment, SimplifiedTVItem } from "../data/tv.js";
import { playIcon } from "../utils/icons.js";
import { search, SearchResult, SearchToken } from "../data/search.js";

function getISODateString(date: Date) {
    return date.toISOString().split("T")[0];
}

function formatDate(dateString: string) {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");

    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatDuration(durationInSeconds: number): string {
    if (durationInSeconds === 0) return "0s";

    const hours = Math.floor(durationInSeconds / 3600);
    const minutes = Math.floor((durationInSeconds % 3600) / 60);
    const seconds = durationInSeconds % 60;

    const parts: string[] = [];

    if (hours > 0) {
        parts.push(`${hours}h`);
    }
    if (minutes > 0) {
        parts.push(`${minutes}m`);
    }
    if (seconds > 0) {
        parts.push(`${seconds}s`);
    }

    return parts.join(" ");
}

function highlightText(text: string, tokens: SearchToken[]): string {
    if (!tokens.length) return text;

    const chunks: string[] = [];
    const lowerText = text.toLowerCase();
    let lastIndex = 0;

    // Find all matches and their positions
    const matches = tokens
        .flatMap((token) => {
            const positions: Array<{ start: number; end: number }> = [];
            let pos = 0;
            while ((pos = lowerText.indexOf(token.value, pos)) !== -1) {
                positions.push({
                    start: pos,
                    end: pos + token.value.length,
                });
                pos += token.value.length;
            }
            return positions;
        })
        .sort((a, b) => a.start - b.start);

    // Merge overlapping matches
    const mergedMatches = matches.reduce((acc: Array<{ start: number; end: number }>, match) => {
        const last = acc[acc.length - 1];
        if (last && match.start <= last.end) {
            last.end = Math.max(last.end, match.end);
        } else {
            acc.push(match);
        }
        return acc;
    }, []);

    // Build highlighted text
    mergedMatches.forEach((match) => {
        chunks.push(text.slice(lastIndex, match.start), `<mark>${text.slice(match.start, match.end)}</mark>`);
        lastIndex = match.end;
    });
    chunks.push(text.slice(lastIndex));

    return chunks.join("");
}

const chevronDownIcon = svg`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="6 9 12 15 18 9"></polyline>
  </svg>
`;

const chevronUpIcon = svg`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="18 15 12 9 6 15"></polyline>
  </svg>
`;

interface ParsedSubtitle {
    index: number;
    time: string;
    text: string;
}

@customElement("tv-segment")
export class TVSegment extends BaseElement {
    @property()
    segment!: EpisodeSegment;

    @property()
    episode!: SimplifiedTVItem;

    @property()
    searchTokens: SearchToken[] = [];

    @state()
    private showFullTranscript = false;

    private toggleFullTranscript() {
        this.showFullTranscript = !this.showFullTranscript;
    }

    private parseSubtitles(): ParsedSubtitle[] {
        if (!this.segment.subtitles) return [];

        return this.segment.subtitles
            .split("\n\n")
            .slice(1) // Skip the WEBVTT header
            .map((block, index) => {
                const lines = block.split("\n");
                if (lines.length < 3) return null;
                return {
                    index,
                    time: lines[1],
                    text: lines.slice(2).join(" "),
                };
            })
            .filter((sub): sub is ParsedSubtitle => sub !== null);
    }

    private getMatchingSubtitles(): { matches: ParsedSubtitle[]; context: ParsedSubtitle[] }[] {
        const subtitles = this.parseSubtitles();

        if (this.showFullTranscript) {
            return [
                {
                    matches: this.searchTokens.length
                        ? subtitles.filter((sub) => this.searchTokens.some((token) => sub.text.toLowerCase().includes(token.value)))
                        : [],
                    context: subtitles,
                },
            ];
        }

        if (!this.searchTokens.length) {
            return [];
        }

        // Find matching subtitles
        const matchingIndices = new Set<number>();
        subtitles.forEach((sub, idx) => {
            const text = sub.text.toLowerCase();
            if (this.searchTokens.some((token) => text.includes(token.value))) {
                matchingIndices.add(idx);
            }
        });

        if (matchingIndices.size === 0) {
            return [];
        }

        // Group matches into chunks
        const sortedIndices = Array.from(matchingIndices).sort((a, b) => a - b);
        const chunks: { matches: ParsedSubtitle[]; context: ParsedSubtitle[] }[] = [];
        const contextSize = 5;

        let currentChunkStart = -1;
        let currentChunkMatches: number[] = [];

        // Group matches that are within contextSize*2 of each other
        sortedIndices.forEach((idx) => {
            if (currentChunkStart === -1) {
                currentChunkStart = idx;
                currentChunkMatches = [idx];
            } else if (idx <= currentChunkMatches[currentChunkMatches.length - 1] + contextSize * 2) {
                currentChunkMatches.push(idx);
            } else {
                // Create chunk for the previous group
                chunks.push(this.createChunk(subtitles, currentChunkMatches, contextSize));
                // Start new chunk
                currentChunkStart = idx;
                currentChunkMatches = [idx];
            }
        });

        // Add the last chunk
        if (currentChunkMatches.length > 0) {
            chunks.push(this.createChunk(subtitles, currentChunkMatches, contextSize));
        }

        return chunks;
    }

    private createChunk(
        subtitles: ParsedSubtitle[],
        matchIndices: number[],
        contextSize: number
    ): { matches: ParsedSubtitle[]; context: ParsedSubtitle[] } {
        const firstMatch = matchIndices[0];
        const lastMatch = matchIndices[matchIndices.length - 1];

        const startIdx = Math.max(0, firstMatch - contextSize);
        const endIdx = Math.min(subtitles.length - 1, lastMatch + contextSize);

        const matchSet = new Set(matchIndices);
        const matches = matchIndices.map((idx) => subtitles[idx]);
        const contextRange = subtitles.slice(startIdx, endIdx + 1);
        const context = contextRange.filter((sub) => !matchSet.has(sub.index));

        return { matches, context };
    }

    private renderSubtitleItem(sub: ParsedSubtitle, isMatch: boolean = false) {
        return html`
            <div class="mb-2 ${isMatch ? "bg-yellow-50 -mx-4 px-4 py-1" : ""}">
                <span class="text-gray-400 text-xs">${sub.time}</span>
                <div class="text-gray-700" .innerHTML=${highlightText(sub.text, this.searchTokens)}></div>
            </div>
        `;
    }

    private renderSubtitles() {
        if (!this.segment.subtitles) return null;

        const chunks = this.getMatchingSubtitles();
        if (chunks.length === 0) return null;

        return html`
            <div class="mt-4 bg-gray-50 p-4 rounded-lg text-sm">
                ${chunks.map(
                    (chunk, i) => html`
                        <div class="${i > 0 ? "mt-6" : ""}">
                            ${this.showFullTranscript
                                ? chunk.context.map((sub) =>
                                      this.renderSubtitleItem(
                                          sub,
                                          chunk.matches.some((m) => m.index === sub.index)
                                      )
                                  )
                                : [...chunk.context, ...chunk.matches]
                                      .sort((a, b) => a.index - b.index)
                                      .map((sub) => this.renderSubtitleItem(sub, chunk.matches.includes(sub)))}
                        </div>
                    `
                )}
                ${chunks.length > 0 && !this.showFullTranscript
                    ? html`
                          <button @click=${() => this.toggleFullTranscript()} class="mt-4 text-blue-600 hover:text-blue-800 text-sm">
                              Show full transcript
                          </button>
                      `
                    : null}
            </div>
        `;
    }

    render() {
        const s = this.segment;
        const hasSubtitles = Boolean(s.subtitles);
        const hasMatches =
            this.searchTokens.length > 0 && s.subtitles ? this.searchTokens.some((token) => s.subtitles!.toLowerCase().includes(token.value)) : false;

        return html`
            <div class="border p-4 flex flex-col bg-gray-100">
                <span class="font-bold" .innerHTML=${highlightText(s.title, this.searchTokens)}></span>
                <div class="flex items-center gap-2">
                    <i class="border border-2 border-green-600 rounded-full w-8 h-8 icon text-green-600">${playIcon}</i>
                    <span class="text-xs text-gray-400">${formatDuration(s.durationInSeconds)}</span>
                    ${hasSubtitles
                        ? html`
                              <button
                                  @click=${() => (this.showFullTranscript = !this.showFullTranscript)}
                                  class="ml-auto text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                              >
                                  ${this.showFullTranscript ? "Hide" : "Show"} Subtitles
                                  <i class="w-4 h-4"> ${this.showFullTranscript ? chevronUpIcon : chevronDownIcon} </i>
                              </button>
                          `
                        : null}
                </div>
                <div class="text-gray-700 whitespace-pre-line mt-2" .innerHTML=${highlightText(s.description, this.searchTokens)}></div>
                ${this.renderSubtitles()}
            </div>
        `;
    }
}

class VisibilityManager {
    private static instance: VisibilityManager;
    private observer: IntersectionObserver;
    private elements = new Map<Element, (visible: boolean) => void>();

    private constructor() {
        this.observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    this.elements.get(entry.target)?.(entry.isIntersecting);
                });
            },
            { rootMargin: "50px" }
        );
    }

    static getInstance(): VisibilityManager {
        if (!VisibilityManager.instance) {
            VisibilityManager.instance = new VisibilityManager();
        }
        return VisibilityManager.instance;
    }

    observe(element: Element, callback: (visible: boolean) => void) {
        this.elements.set(element, callback);
        this.observer.observe(element);
    }

    unobserve(element: Element) {
        this.elements.delete(element);
        this.observer.unobserve(element);
    }
}

export const visibilityManager = VisibilityManager.getInstance();

@customElement("tv-episode")
export class TvEpisode extends BaseElement {
    @property()
    episode!: SimplifiedTVItem;

    @property()
    searchTokens: SearchToken[] = [];

    private isVisible = false;

    connectedCallback() {
        super.connectedCallback();
        visibilityManager.observe(this, (visible) => {
            this.isVisible = visible;
            this.requestUpdate();
        });
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        visibilityManager.unobserve(this);
    }

    render() {
        const e = this.episode;
        return html`<div class="px-4 py-4 mb-4 shadow-md flex flex-col bg-white">
            ${this.isVisible
                ? html`
                      <span class="font-bold" .innerHTML=${highlightText(e.title, this.searchTokens)}></span>
                      <span class="text-xs text-gray-500 mb-4">${formatDate(e.date)}</span>
                      <img class="rounded mb-4 shadow-md" src="${e.playerImage}" loading="lazy" />
                      ${e.segments
                          ? html`<div class="flex flex-col gap-4">
                                ${e.segments.map(
                                    (s) => html`<tv-segment .episode=${e} .segment=${s} .searchTokens=${this.searchTokens}></tv-segment>`
                                )}
                            </div>`
                          : html`<div class="whitespace-pre-line" .innerHTML=${highlightText(e.description, this.searchTokens)}></div>`}
                  `
                : html`<div class="h-48"></div>`}
        </div>`;
    }
}

@customElement("main-page")
export class MainPage extends BaseElement {
    @state()
    loading = true;

    @state()
    error?: string;

    @state()
    data: SimplifiedTVItem[] = [];

    @state()
    searchResult: SearchResult = { items: [], tokens: [] };

    @state()
    startDate = new Date();

    @state()
    endDate = new Date();

    @state()
    subtitles = true;

    @state()
    query = "";

    @state()
    selectedBroadcasts: Set<string> = new Set();

    async load() {
        try {
            this.loading = true;
            this.searchResult = { items: [], tokens: [] };
            this.data = await Api.news({ start: getISODateString(this.startDate), end: getISODateString(this.endDate), subs: this.subtitles });
            // Reset selected broadcasts when loading new data
            this.selectedBroadcasts = new Set();
            this.search();
        } catch (e) {
            this.error = "Could not load data.";
            console.error(this.error, e);
        } finally {
            this.loading = false;
        }
    }

    search() {
        if (this.query.length < 3) {
            const filteredItems =
                this.selectedBroadcasts.size > 0 ? this.data.filter((item) => this.selectedBroadcasts.has(item.title)) : [...this.data];
            this.searchResult = { items: filteredItems, tokens: [] };
        } else {
            const start = performance.now();
            const searchResult = search(this.query, this.data, this.subtitles);
            const filteredItems =
                this.selectedBroadcasts.size > 0 ? searchResult.items.filter((item) => this.selectedBroadcasts.has(item.title)) : searchResult.items;
            this.searchResult = { items: filteredItems, tokens: searchResult.tokens };
            console.log(`Search took: ${performance.now() - start} ms`);
        }
    }

    protected firstUpdated(_changedProperties: PropertyValues): void {
        super.firstUpdated(_changedProperties);
        this.startDate.setDate(this.endDate.getDate() - 30);
        this.load();
    }

    private getUniqueBroadcasts(): string[] {
        return [...new Set(this.data.map((item) => item.title))].sort();
    }

    private toggleBroadcast(title: string) {
        const newSelected = new Set(this.selectedBroadcasts);
        if (newSelected.has(title)) {
            newSelected.delete(title);
        } else {
            newSelected.add(title);
        }
        this.selectedBroadcasts = newSelected;
        this.search();
    }

    render() {
        let searchTimeout: any;

        const handleSearchInput = () => {
            this.query = this.querySelector<HTMLInputElement>("#query")!.value.trim();
            clearTimeout(searchTimeout);

            searchTimeout = setTimeout(() => {
                this.search();
            }, 200);
        };

        const handleDateChange = () => {
            this.startDate = new Date(this.querySelector<HTMLInputElement>("#startDate")!.value);
            this.endDate = new Date(this.querySelector<HTMLInputElement>("#endDate")!.value);
            this.subtitles = this.querySelector<HTMLInputElement>("#subtitles")!.checked;
            this.load();
        };

        const uniqueBroadcasts = this.getUniqueBroadcasts();

        return html`<div class="w-full min-h-[100vh] bg-gray-200">
            <div class="max-w-[600px] mx-auto pb-4 pt-8 px-4 flex flex-col gap-4">
                <h1>OpenORF</h1>
                ${this.error ? html`<span class="border border-red-500 bg-red-100 px-4 py-2 rounded shadow-md">Error: ${this.error}</span>` : ""}
                <div class="flex flex-col gap-1">
                    <div class="flex gap-1 font-bold w-full">
                        <span class="w-full">From</span>
                        <span class="w-full">To</span>
                    </div>
                    <div class="flex gap-1">
                        <input
                            id="startDate"
                            @change=${handleDateChange}
                            type="date"
                            .value=${getISODateString(this.startDate)}
                            .max=${getISODateString(this.endDate)}
                        />
                        <input
                            id="endDate"
                            @change=${handleDateChange}
                            type="date"
                            .value=${getISODateString(this.endDate)}
                            .min=${getISODateString(this.startDate)}
                        />
                    </div>
                </div>
                ${this.loading ? html`<span>Loading ...</span>` : ""}
                ${!this.loading
                    ? html` <div class="flex flex-col gap-1">
                              <span class="font-bold">Broadcasts</span>
                              <div class="flex flex-wrap gap-2">
                                  ${uniqueBroadcasts.map(
                                      (title) => html`
                                          <button
                                              @click=${() => this.toggleBroadcast(title)}
                                              class="px-3 py-1 rounded-full text-sm ${this.selectedBroadcasts.has(title)
                                                  ? "bg-blue-600 text-white"
                                                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"}"
                                          >
                                              ${title}
                                          </button>
                                      `
                                  )}
                              </div>
                          </div>
                          <div class="flex flex-col gap-1">
                              <span class="font-bold">Search</span>
                              <input id="query" @input=${handleSearchInput} class="p-4" type="text" placeholder="Search ..." .value=${this.query} />
                          </div>
                          <label
                              ><input id="subtitles" @change=${handleDateChange} type="checkbox" .checked=${this.subtitles} /> Search subtitles</label
                          >
                          <span class="font-bold"
                              >Found ${this.searchResult.items.length} ${this.searchResult.items.length == 1 ? "broadcast" : "broadcasts"}</span
                          >`
                    : ""}
                ${this.searchResult.items.map((e) => html`<tv-episode .episode=${e} .searchTokens=${this.searchResult.tokens}></tv-episode>`)}
            </div>
        </div>`;
    }
}
