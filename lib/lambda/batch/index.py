import boto3
from datetime import datetime
import json
import logging
import os
import pymysql
import socket

# ログ設定
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# aws client
s3 = boto3.client("s3")
secrets_manager = boto3.client("secretsmanager")

# 環境変数
OUTPUT_BUCKET_NAME = os.environ.get("OUTPUT_BUCKET_NAME")
DB_SECRET_ARN = os.environ.get("DB_SECRET_ARN")

def handler(event, context):
    logger.info("Batch function execution started")

    # シークレットマネージャーからDBの秘密情報を取得
    response = secrets_manager.get_secret_value(SecretId=DB_SECRET_ARN)
    db_info = json.loads(response['SecretString'])

    # DB接続
    connection = pymysql.connect(
        host=db_info['host'],
        user=db_info['username'],
        password=db_info['password'],
        database=db_info['dbname'],
        port=int(db_info['port']),
        connect_timeout=15
    )

    try:
        # 名前解決とポートの疎通確認
        socket.create_connection((db_info['host'], 3306), timeout=5)
        logger.info("TCP Port 3306 is reachable!")
    except Exception as e:
        logger.error(f"Cannot reach port 3306: {e}")

    try:
        with connection.cursor() as cursor:
            cursor.execute("CREATE TABLE IF NOT EXISTS test_table (id INT PRIMARY KEY AUTO_INCREMENT, data VARCHAR(255))")
            cursor.execute("SELECT COUNT(*) FROM test_table")
            result = cursor.fetchone()
            logger.info(f"Database query result: {result}")
    finally:
        connection.close()

    # TODO: Batch jobのロジックを実装する

    try:
        # S3に出力ファイルを追加
        s3.put_object(
            Bucket=OUTPUT_BUCKET_NAME,
            Key=f"logs/batch-log-{datetime.now().strftime('%Y%m%d%H%M%S')}.json",
            Body=json.dumps(result), # JSON文字列に変換
            ContentType="application/json"
        )
        logger.info(f"Successfully uploaded to {OUTPUT_BUCKET_NAME}")

    except Exception as e:
        logger.error(f"Error uploading to S3: {str(e)}")
        raise e

    return result
