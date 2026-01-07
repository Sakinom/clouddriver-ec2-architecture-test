import boto3
from datetime import datetime
import json
import logging
import os

# ログ設定
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# S3クライアント
s3 = boto3.client("s3")

# 出力バケット名
OUTPUT_BUCKET_NAME = os.environ.get("OUTPUT_BUCKET_NAME")

def handler(event, context):
    logger.info("Batch function execution started")

    # TODO: Batch jobのロジックを実装する

    # バッチ処理の結果を想定したデータ
    result_data = {
        "status": "success",
        "timestamp": datetime.now().isoformat(),
        "message": "Batch process completed successfully",
        "processed_items": 100 # 実際はここにロジックの結果を入れる
    }

    try:
        # S3に出力ファイルを追加
        s3.put_object(
            Bucket=OUTPUT_BUCKET_NAME,
            Key=f"logs/batch-log-{datetime.now().strftime('%Y%m%d%H%M%S')}.json",
            Body=json.dumps(result_data), # JSON文字列に変換
            ContentType="application/json"
        )
        logger.info(f"Successfully uploaded to {OUTPUT_BUCKET_NAME}")

    except Exception as e:
        logger.error(f"Error uploading to S3: {str(e)}")
        raise e

    return result_data
