"""Cleaning and chunking. Pure functions, no PDF binary, no model, no database."""

import pytest

from pdf import CHUNK_OVERLAP, CHUNK_SIZE, Block, Chunk, chunk_text, clean, read_order

PAGE_WIDTH = 575.0
LEFT, RIGHT = 36.0, 293.0
COLUMN_END, FULL_END = 281.0, 538.0


def col(y, text, x0=LEFT):
    """A single-column body block."""
    return Block(x0=x0, y0=y, x1=x0 + 245.0, text=text)


def wide(y, text):
    """A block spanning both columns — a caption or a wide table."""
    return Block(x0=LEFT, y0=y, x1=FULL_END, text=text)


class TestReadOrder:
    def test_reads_left_column_fully_before_right(self):
        # The bug this guards: ordering by position alone walks across both
        # columns and back, so the text jumps mid-argument.
        blocks = [col(400, "right upper", RIGHT), col(300, "left upper"), col(500, "left lower"),
                  col(600, "right lower", RIGHT)]
        body, _ = read_order(blocks, PAGE_WIDTH)
        assert [b.text for b in body] == ["left upper", "left lower", "right upper", "right lower"]

    def test_lifts_a_full_width_caption_out_of_the_body(self):
        # A figure physically sits between two halves of a sentence. Left
        # inline, the caption splits it wherever the typesetter put the figure.
        blocks = [col(200, "converted to 50 VDC by a"), wide(280, "FIGURE 1. Grid-to-chip power"),
                  col(340, "power supply unit (PSU).")]
        body, captions = read_order(blocks, PAGE_WIDTH)
        assert [b.text for b in body] == ["converted to 50 VDC by a", "power supply unit (PSU)."]
        assert [b.text for b in captions] == ["FIGURE 1. Grid-to-chip power"]

    def test_lifts_a_narrow_caption_by_its_label(self):
        # Some captions fit inside one column and miss the width test.
        blocks = [col(200, "body text"), col(300, "TABLE 2. Key Specifications")]
        body, captions = read_order(blocks, PAGE_WIDTH)
        assert [b.text for b in body] == ["body text"]
        assert [b.text for b in captions] == ["TABLE 2. Key Specifications"]

    def test_empty_page(self):
        assert read_order([], PAGE_WIDTH) == ([], [])


class TestClean:
    def test_captions_follow_the_page_body(self):
        pages = [[col(200, "first half"), wide(280, "FIGURE 1. A diagram"), col(340, "second half")]]
        assert clean(pages, PAGE_WIDTH) == "first half\n\nsecond half\n\nFIGURE 1. A diagram"

    def test_drops_bare_page_numbers_and_their_dressings(self):
        pages = [[col(100, "Alpha"), col(200, "12")], [col(100, "Beta"), col(200, "- 13 -")],
                 [col(100, "Gamma"), col(200, "Page 14")], [col(100, "Delta"), col(200, "15 of 40")]]
        result = clean(pages, PAGE_WIDTH)
        assert not any(char.isdigit() for char in result)
        assert "Gamma" in result

    def test_rejoins_a_word_broken_across_a_line(self):
        assert "photosynthesis converts" in clean([[col(100, "photo-\nsynthesis converts light.")]], PAGE_WIDTH)

    def test_leaves_a_hyphen_inside_a_line_alone(self):
        assert "well-known" in clean([[col(100, "A well-known result.")]], PAGE_WIDTH)

    def test_leaves_a_compound_broken_before_a_capital_alone(self):
        # "State-of-the-\nArt" is a real compound, not a syllable break.
        # Joining it would produce "State-of-theArt".
        assert "State-of-the-" in clean([[col(100, "State-of-the-\nArt design.")]], PAGE_WIDTH)

    def test_expands_ligatures(self):
        # Typeset PDFs use single glyphs for these; left alone they reach the
        # model as words no tokeniser splits the way it would the ASCII form.
        assert clean([[col(100, "ﬁrst speciﬁcations ﬂow")]], PAGE_WIDTH) == "first specifications flow"

    def test_unwraps_lines_within_a_block(self):
        assert clean([[col(100, "one line\nnext line")]], PAGE_WIDTH) == "one line next line"

    def test_skips_blocks_that_are_only_whitespace(self):
        assert clean([[col(100, "kept"), col(200, "   \n  ")]], PAGE_WIDTH) == "kept"


class TestChunkText:
    LONG = "".join(chr(33 + (i % 90)) for i in range(10_000))

    def test_overlaps_neighbours_by_exactly_the_overlap(self):
        chunks = chunk_text(self.LONG)
        assert len(chunks) > 2
        for previous, current in zip(chunks, chunks[1:]):
            assert current.text[:CHUNK_OVERLAP] == previous.text[-CHUNK_OVERLAP:]

    def test_ordinals_run_without_gaps(self):
        assert [c.ordinal for c in chunk_text(self.LONG)] == list(range(len(chunk_text(self.LONG))))

    def test_text_shorter_than_one_window_gives_one_chunk(self):
        assert chunk_text("Short document.") == [Chunk(ordinal=0, text="Short document.")]

    def test_text_exactly_one_window_gives_one_chunk(self):
        assert len(chunk_text("y" * CHUNK_SIZE)) == 1

    def test_drops_a_trailing_window_contained_in_its_predecessor(self):
        # Stride is 2,600, so 2,700 chars would otherwise emit a second chunk
        # of 100 characters the first already covers in full.
        assert len(chunk_text("z" * (CHUNK_SIZE - CHUNK_OVERLAP + 100))) == 1

    def test_covers_the_end_of_the_document(self):
        assert chunk_text(self.LONG)[-1].text.endswith(self.LONG[-50:])

    @pytest.mark.parametrize("text", ["", "   \n\n  "])
    def test_empty_or_whitespace_gives_nothing(self, text):
        assert chunk_text(text) == []
