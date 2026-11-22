import os
import io
import json
import logging
from datetime import datetime
from typing import Dict, Any, Tuple

from flask import Flask, render_template, request, jsonify, send_file, send_from_directory, url_for
from markupsafe import Markup, escape
from flask_cors import CORS
from werkzeug.utils import secure_filename
import pandas as pd

from config import config
from services.audio_service import AudioService

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def create_app(config_name: str = 'default') -> Flask:
    """
    Create and configure the Flask application.

    Args:
        config_name: Configuration environment name.

    Returns:
        Configured Flask application instance.
    """
    app = Flask(__name__)
    app.config.from_object(config[config_name])
    CORS(app)  # Enable CORS for API calls
    
    # Initialize service
    # We attach it to app to make it accessible if needed, or just keep it global in the module scope 
    # if strictly necessary, but dependency injection is better.
    # For this simple flask app, we can initialize it here or inside the app context.
    # To keep it simple and consistent with previous design, we'll initialize usage based on current config context.
    
    return app

# Initialize app using environment variable
env_config = os.environ.get('FLASK_ENV', 'development')
app = create_app(env_config)

# Initialize Audio Service
audio_service = AudioService(config[env_config])


# ---------------------------------------------------------------------------------------------
# Pages in two languages: / is English, /vi/ is Vietnamese. The words live in i18n/<lang>.json.
# ---------------------------------------------------------------------------------------------
LANGS = ('en', 'vi')
_I18N_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'i18n')


def _load_words(lang: str) -> Dict[str, str]:
    with open(os.path.join(_I18N_DIR, lang + '.json'), encoding='utf-8') as fh:
        return json.load(fh)


WORDS = {lang: _load_words(lang) for lang in LANGS}


def render_page(lang: str):
    """Render the single page in one language. A missing Vietnamese word falls back to English."""
    words = dict(WORDS['en'])
    words.update(WORDS[lang])
    return render_template(
        'index.html',
        lang=lang,
        t=lambda key: words.get(key, key),
        words_json=json.dumps(words, ensure_ascii=False).replace('<', '\\u003c'),
        other_lang='vi' if lang == 'en' else 'en',
    )


@app.route('/')
def index():
    """Main page route (English)"""
    return render_page('en')


@app.route('/vi/')
def index_vi():
    """Main page route (Vietnamese)"""
    return render_page('vi')


# ---------------------------------------------------------------------------------------------
# Pixel sprites. static/pixel/<group>/<name>.png is the real art; until it exists the stand-in in
# static/pixel/_placeholder/ is used (python scripts/make_placeholders.py draws them).
# ---------------------------------------------------------------------------------------------
with open(os.path.join(app.static_folder, 'pixel', 'sprites.json'), encoding='utf-8') as _fh:
    SPRITES = json.load(_fh)


def sprite_url(name: str) -> str:
    real = os.path.join('pixel', name + '.png')
    use = real if os.path.exists(os.path.join(app.static_folder, real)) else os.path.join('pixel', '_placeholder', name + '.png')
    version = int(os.path.getmtime(os.path.join(app.static_folder, use)))   # a new file means a new URL
    return url_for('static', filename=use.replace(os.sep, '/'), v=version)


@app.template_global()
def sprite(name: str, scale: int = 1, cls: str = ''):
    """<img> for a sprite, shown at a whole-number multiple of its real size so the pixels stay crisp."""
    width, height = SPRITES[name]
    return Markup('<img class="px %s" src="%s" width="%d" height="%d" alt="" data-sprite="%s">' % (
        escape(cls), escape(sprite_url(name)), width * scale, height * scale, escape(name)))


@app.template_global()
def sprite_src(name: str) -> str:
    return sprite_url(name)


@app.after_request
def add_headers(response):
    """Small hardening headers. Framing is deliberately NOT restricted: the portfolio embeds this app."""
    response.headers.setdefault('X-Content-Type-Options', 'nosniff')
    response.headers.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
    return response


@app.route('/health')
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'message': 'Music Note Detector is running!',
        'version': '1.0.0'
    })


def resolve_upload(value) -> Any:
    """Server path of an uploaded file, from the file name the client sends.

    Only the base name is used, and only inside UPLOAD_FOLDER, so a client can never point the
    server at another file (the old API took a full path, which /cleanup would then delete).
    Returns None when there is no such upload.
    """
    name = secure_filename(os.path.basename(str(value or '')))
    if not name:
        return None
    path = os.path.join(os.path.abspath(app.config['UPLOAD_FOLDER']), name)
    return path if os.path.isfile(path) else None


def allowed_file(filename: str) -> bool:
    """
    Check if file extension is allowed.

    Args:
        filename: Name of the file.

    Returns:
        True if extension is allowed, False otherwise.
    """
    return '.' in filename and \
        filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']


@app.route('/upload', methods=['POST'])
def upload_file():
    """Handle file upload"""
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file part'}), 400

        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No selected file'}), 400

        if file and allowed_file(file.filename):
            # Generate unique filename
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = secure_filename(file.filename)
            name, ext = os.path.splitext(filename)
            unique_filename = f"{name}_{timestamp}{ext}"

            filepath = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
            file.save(filepath)

            # Get file size
            file_size = os.path.getsize(filepath)

            # Load audio metadata
            try:
                metadata = audio_service.load_audio_metadata(filepath)

                return jsonify({
                    'success': True,
                    'filename': unique_filename,
                    'file_size': file_size,
                    'duration': metadata.get('duration'),
                    'sample_rate': metadata.get('sample_rate'),
                    'format': ext[1:].upper().replace('.', ''),
                    'metadata': metadata
                })
            except Exception as e:
                audio_service.cleanup_file(filepath)  # Clean up on error
                return jsonify({'error': f'Invalid audio file: {str(e)}'}), 400

        return jsonify({'error': 'File type not allowed'}), 400

    except Exception as e:
        logger.error(f"Upload error: {str(e)}")
        return jsonify({'error': 'Upload failed'}), 500


@app.route('/analyze', methods=['POST'])
def analyze_audio():
    """Analyze uploaded audio file"""
    try:
        data = request.json
        if not data:
             return jsonify({'error': 'No data provided'}), 400
             
        filepath = resolve_upload(data.get('filename') or data.get('filepath'))
        mode = data.get('mode', 'standard')
        if mode not in ('quick', 'standard', 'advanced'):
            mode = 'standard'

        if not filepath:
            return jsonify({'error': 'File not found'}), 404

        # Perform analysis via service
        result_data = audio_service.analyze_audio(filepath, mode)
        return jsonify(result_data)

    except Exception as e:
        logger.error(f"Analysis error: {str(e)}")
        return jsonify({'error': f'Analysis failed: {str(e)}'}), 500


@app.route('/progress/<filename>')
def get_progress(filename: str):
    """Get analysis progress"""
    progress = audio_service.get_progress(filename)
    return jsonify({'progress': progress})


@app.route('/visualize', methods=['POST'])
def create_visualizations():
    """Create visualization data for audio file"""
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'No data provided'}), 400
            
        filepath = resolve_upload(data.get('filename') or data.get('filepath'))

        if not filepath:
            return jsonify({'error': 'File not found'}), 404

        # Create visualizations
        viz_data = audio_service.create_visualizations(filepath)

        return jsonify({
            'success': True,
            'visualizations': viz_data
        })

    except Exception as e:
        logger.error(f"Visualization error: {str(e)}")
        return jsonify({'error': 'Visualization failed'}), 500


@app.route('/export/<format>', methods=['POST'])
def export_results(format: str):
    """Export analysis results in different formats"""
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'No data provided'}), 400
            
        results = data.get('results', [])
        filename = data.get('filename', 'results')

        if not results:
            return jsonify({'error': 'No results to export'}), 400

        # Create DataFrame
        df = pd.DataFrame(results)

        # Generate filename
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        base_filename = f"note_detection_{filename}_{timestamp}"

        if format == 'csv':
            output = io.StringIO()
            df.to_csv(output, index=False)
            output.seek(0)

            return send_file(
                io.BytesIO(output.getvalue().encode()),
                mimetype='text/csv',
                as_attachment=True,
                download_name=f"{base_filename}.csv"
            )

        elif format == 'excel':
            output = io.BytesIO()
            with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
                df.to_excel(writer, index=False, sheet_name='Note Detection Results')

                # Get workbook and worksheet
                workbook = writer.book
                worksheet = writer.sheets['Note Detection Results']

                # Add formatting
                header_format = workbook.add_format({
                    'bold': True,
                    'bg_color': '#7c3aed',
                    'font_color': 'white',
                    'border': 1
                })

                # Write headers with formatting
                for col_num, value in enumerate(df.columns.values):
                    worksheet.write(0, col_num, value, header_format)

                # Auto-adjust column widths
                for i, col in enumerate(df.columns):
                    max_len = max(df[col].astype(str).str.len().max(), len(col)) + 2
                    worksheet.set_column(i, i, max_len)

            output.seek(0)

            return send_file(
                output,
                mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                as_attachment=True,
                download_name=f"{base_filename}.xlsx"
            )

        elif format == 'txt':
            output = io.StringIO()
            output.write("Music Note Detection Results\n")
            output.write("=" * 50 + "\n\n")
            output.write(df.to_string(index=False))
            output.seek(0)

            return send_file(
                io.BytesIO(output.getvalue().encode()),
                mimetype='text/plain',
                as_attachment=True,
                download_name=f"{base_filename}.txt"
            )

        else:
            return jsonify({'error': 'Invalid format'}), 400

    except Exception as e:
        logger.error(f"Export error: {str(e)}")
        return jsonify({'error': 'Export failed'}), 500


@app.route('/cleanup', methods=['POST'])
def cleanup_file():
    """Remove uploaded file"""
    try:
        data = request.json
        filepath = resolve_upload(data.get('filename') or data.get('filepath'))

        if not filepath:
            return jsonify({'error': 'File not found'}), 404

        if audio_service.cleanup_file(filepath):
            return jsonify({'success': True, 'message': 'File removed'})

        return jsonify({'error': 'File not found'}), 404

    except Exception as e:
        logger.error(f"Cleanup error: {str(e)}")
        return jsonify({'error': 'Cleanup failed'}), 500

@app.route('/static/uploads/<filename>')
def uploaded_file(filename):
    """Serve uploaded files"""
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


@app.errorhandler(413)
def too_large(e):
    return jsonify({'error': 'File too large. Maximum size is 50MB'}), 413


@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404


@app.errorhandler(500)
def server_error(e):
    return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000)