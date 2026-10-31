from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('assets', '0002_asset_move_bookkeeping'),
    ]

    operations = [
        migrations.AddField(
            model_name='asset',
            name='width',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='asset',
            name='height',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='asset',
            name='web_widths',
            field=models.JSONField(blank=True, db_default=[], default=list),
        ),
    ]
